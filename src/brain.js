// Sends the conversation to Claude and gets the friend's reply.
import Anthropic from "@anthropic-ai/sdk";

const client = new Anthropic(); // reads ANTHROPIC_API_KEY from .env
const MODEL = process.env.CLAUDE_MODEL || "claude-opus-5-5";
const REFUSAL_REPLY = "Hmm, I'd rather not get into that one. Want to talk about something else?";

function baseRequest(systemPrompt, messages) {
  return {
    model: MODEL,
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
