// Long-term memory: the friend saves key points about each person and
// brings them up in later chats. Stored in data/memories/<user id>.json
// on your computer (never uploaded to GitHub).
import fs from "node:fs";
import path from "node:path";
import Anthropic from "@anthropic-ai/sdk";

const DIR = path.resolve("data/memories");
const MAX_FACTS = Number(process.env.MEMORY_MAX_FACTS) || 40;
const SAVE_EVERY = Number(process.env.MEMORY_SAVE_EVERY) || 6; // messages from a person
const IDLE_SAVE_MS = 5 * 60 * 1000; // also save after 5 quiet minutes

const client = new Anthropic();
const MODEL = process.env.CLAUDE_MODEL || "claude-opus-5-5";

// userId -> { name, lines: [], count, timer }
const pending = new Map();

function fileFor(userId) {
  return path.join(DIR, `${userId}.json`);
}

export function loadMemory(userId) {
  try {
    return JSON.parse(fs.readFileSync(fileFor(userId), "utf8"));
  } catch {
    return { facts: [], updatedAt: null };
  }
}

function saveMemory(userId, memory) {
  fs.mkdirSync(DIR, { recursive: true });
  fs.writeFileSync(fileFor(userId), JSON.stringify(memory, null, 2));
}

export function forgetUser(userId) {
  pending.delete(userId);
  try {
    fs.unlinkSync(fileFor(userId));
    return true;
  } catch {
    return false;
  }
}

// Text added to the friend's instructions so it knows what it remembers.
export function memoryPrompt(userId, name) {
  const { facts } = loadMemory(userId);
  if (!facts.length) {
    return `\nYou don't remember anything about ${name} yet. Get to know them naturally.`;
  }
  return [
    "",
    `Things you remember about ${name} from earlier chats (bring them up naturally when it fits, don't list them):`,
    ...facts.map((f) => `- ${f}`),
  ].join("\n");
}

// Call this for every line of a conversation that involves a person.
export function noteExchange(userId, name, userLine, friendReply) {
  const entry = pending.get(userId) || { name, lines: [], count: 0, timer: null };
  entry.name = name;
  entry.lines.push(`${name}: ${userLine}`, `Friend: ${friendReply}`);
  entry.count += 1;
  clearTimeout(entry.timer);
  pending.set(userId, entry);

  if (entry.count >= SAVE_EVERY) {
    flush(userId);
  } else {
    entry.timer = setTimeout(() => flush(userId), IDLE_SAVE_MS);
    entry.timer.unref?.();
  }
}

// Save everyone's pending memories now (used on shutdown).
export async function flushAll() {
  await Promise.all([...pending.keys()].map((id) => flush(id)));
}

async function flush(userId) {
  const entry = pending.get(userId);
  if (!entry || !entry.lines.length) return;
  pending.delete(userId);
  clearTimeout(entry.timer);
  try {
    const memory = loadMemory(userId);
    const facts = await extractFacts(entry.name, memory.facts, entry.lines);
    saveMemory(userId, { facts, updatedAt: new Date().toISOString() });
    console.log(`🧠 Updated memory for ${entry.name} (${facts.length} things remembered)`);
  } catch (err) {
    console.error(`Couldn't update memory for ${entry.name}:`, err.message);
  }
}

async function extractFacts(name, oldFacts, lines) {
  const prompt = [
    `You keep the long-term memory for an AI friend who chats and plays games with ${name}.`,
    "",
    "Current memory:",
    oldFacts.length ? oldFacts.map((f) => `- ${f}`).join("\n") : "(empty)",
    "",
    "New conversation:",
    lines.join("\n"),
    "",
    `Return the updated memory as a list of short facts about ${name}, written in third person (e.g. "Loves building castles in Minecraft").`,
    "Keep things that help the friend feel like a real friend: likes and dislikes, games and play style, ongoing projects, plans, inside jokes, people and pets they mention, how they like to be talked to.",
    "Merge duplicates, update facts that changed, and drop trivial ones.",
    "Never save passwords, keys, addresses, phone numbers, or other private details like that.",
    `Keep at most ${MAX_FACTS} facts, most important first.`,
  ].join("\n");

  const response = await client.messages.create({
    model: MODEL,
    max_tokens: 4000,
    output_config: {
      effort: "low",
      format: {
        type: "json_schema",
        schema: {
          type: "object",
          properties: { facts: { type: "array", items: { type: "string" } } },
          required: ["facts"],
          additionalProperties: false,
        },
      },
    },
    messages: [{ role: "user", content: prompt }],
  });

  if (response.stop_reason === "refusal") return oldFacts;
  const text = response.content.filter((b) => b.type === "text").map((b) => b.text).join("");
  const parsed = JSON.parse(text);
  return parsed.facts.map((f) => String(f).trim()).filter(Boolean).slice(0, MAX_FACTS);
}
