// Sends the conversation to Claude and gets the friend's reply.
import Anthropic from "@anthropic-ai/sdk";

const client = new Anthropic(); // reads ANTHROPIC_API_KEY from .env
const MODEL = process.env.CLAUDE_MODEL || "claude-opus-5-5";

export async function getReply(systemPrompt, history) {
  const response = await client.beta.messages.create({
    model: MODEL,
    max_tokens: 1024,
    // Casual chat doesn't need deep thinking; low effort keeps replies quick and cheap.
    output_config: { effort: "low" },
    // If the main model declines a message, Claude retries on a fallback model.
    betas: ["server-side-fallback-2026-07-01"],
    fallbacks: "default",
    system: systemPrompt,
    messages: history,
  });

  if (response.stop_reason === "refusal") {
    return "Hmm, I'd rather not get into that one. Want to talk about something else?";
  }
  const text = response.content
    .filter((block) => block.type === "text")
    .map((block) => block.text)
    .join("")
    .trim();
  return text || "...";
}
