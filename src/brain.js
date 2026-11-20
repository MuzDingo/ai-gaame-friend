// Sends the conversation to Claude and gets the friend's reply.
import Anthropic from "@anthropic-ai/sdk";

const client = new Anthropic(); // reads ANTHROPIC_API_KEY from .env
const MODEL = process.env.CLAUDE_MODEL || "claude-opus-5-5";
const REFUSAL_REPLY = "Hmm, I'd rather not get into that one. Want to talk about something else?";

function baseRequest(systemPrompt, messages, model = MODEL) {
  return {
    model,
    max_tokens: 1024,
    // Casual chat doesn't need deep thinking; low effort keeps replies quick and cheap.
    output_config: { effort: "low" },
    // If the main model declines a message, Claude retries on a fallback model.
    betas: ["server-side-fallback-2026-07-01"],
    fallbacks: "default",
    system: systemPrompt,
    messages,
  };
}

function textOf(response) {
  return response.content
    .filter((block) => block.type === "text")
    .map((block) => block.text)
    .join("")
    .trim();
}

export async function getReply(systemPrompt, history) {
  const response = await client.beta.messages.create(baseRequest(systemPrompt, history));
  if (response.stop_reason === "refusal") return REFUSAL_REPLY;
  return textOf(response) || "...";
}

// Like getReply, but Claude can also take actions (like moving in Minecraft).
// runTool(name, input) must return a short text result.
export async function getReplyWithTools(systemPrompt, history, tools, runTool) {
  const messages = history.map((m) => ({ ...m }));
  for (let round = 0; round < 5; round++) {
    const response = await client.beta.messages.create({ ...baseRequest(systemPrompt, messages), tools });
    if (response.stop_reason === "refusal") return REFUSAL_REPLY;
    if (response.stop_reason !== "tool_use") return textOf(response) || "On it!";

    // Keep Claude's whole turn (including thinking) so the conversation stays valid.
    messages.push({ role: "assistant", content: response.content });
    const results = await Promise.all(
      response.content
        .filter((block) => block.type === "tool_use")
        .map(async (block) => {
          try {
            return { type: "tool_result", tool_use_id: block.id, content: await runTool(block.name, block.input || {}) };
          } catch (err) {
            return { type: "tool_result", tool_use_id: block.id, content: `Failed: ${err.message}`, is_error: true };
          }
        })
    );
    messages.push({ role: "user", content: results });
  }
  return "Okay!";
}

// Streams the reply and calls onSentence(text) for each finished sentence,
// so voice can start speaking right away. Returns the whole reply.
export async function streamReply(systemPrompt, history, onSentence, model) {
  const stream = client.beta.messages.stream(baseRequest(systemPrompt, history.map((m) => ({ ...m })), model || MODEL));
  let buffer = "";
  let spoken = "";
  // Finds where the first sentence (at least 12 characters) ends in the buffer.
  const sentenceEnd = () => {
    const ends = /[.!?…]+["')\]]*\s+/g;
    let m;
    while ((m = ends.exec(buffer))) {
      const cut = m.index + m[0].length;
      if (buffer.slice(0, cut).trim().length >= 12) return cut;
    }
    return -1;
  };
  const flush = (final) => {
    while (true) {
      let cut = sentenceEnd();
      if (cut < 0 && buffer.length > 180) cut = buffer.lastIndexOf(" ", 180) + 1 || buffer.length;
      if (cut < 0 && final && buffer.trim()) cut = buffer.length;
      if (cut <= 0) return;
      const sentence = buffer.slice(0, cut).trim();
      buffer = buffer.slice(cut);
      if (sentence) {
        spoken += (spoken ? " " : "") + sentence;
        onSentence(sentence);
      }
    }
  };
  stream.on("text", (delta) => {
    buffer += delta;
    flush(false);
  });
  const message = await stream.finalMessage();
  if (message.stop_reason === "refusal" && !spoken) {
    onSentence(REFUSAL_REPLY);
    return REFUSAL_REPLY;
  }
  flush(true);
  return spoken || "...";
}
