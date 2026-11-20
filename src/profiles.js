// Loads and saves each person's custom AI friend profile.
// Everyone starts from profiles/default.json. Changes a person makes are
// saved to profiles/users/<their Discord user id>.json.
import fs from "node:fs";
import path from "node:path";

const DEFAULT_FILE = path.resolve("profiles/default.json");
const USERS_DIR = path.resolve("profiles/users");

// Fields people can change with "!friend set <field> <value>".
// Number fields go from 1 (low) to 10 (high).
export const FIELDS = {
  name: { type: "text", help: "What your friend is called" },
  personality: { type: "text", help: "How they act, e.g. calm, sarcastic, hyper" },
  character: { type: "text", help: "Who they are, e.g. a retired space pirate" },
  kindness: { type: "number", help: "1 = blunt and teasing, 10 = super sweet" },
  humor: { type: "number", help: "1 = serious, 10 = jokes constantly" },
  talkativeness: { type: "number", help: "1 = short replies, 10 = chatty" },
  gamerSkill: { type: "number", help: "1 = clueless newbie, 10 = pro player" },
  favoriteGames: { type: "list", help: "Comma separated, e.g. Minecraft, ARK" },
  greeting: { type: "text", help: "What it says when it joins voice. Leave unset and it makes up a fresh hello each time" },
  minecraftName: { type: "text", help: "Your Minecraft username, so your friend knows which player is you" },
  voice: { type: "text", help: "Voice in voice chat, e.g. aura-2-thalia-en or aura-2-orion-en (list in README)" },
  extraNotes: { type: "text", help: "Anything else about how they should act" },
};

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, "utf8"));
}

export function loadProfile(userId) {
  const base = readJson(DEFAULT_FILE);
  const userFile = path.join(USERS_DIR, `${userId}.json`);
  if (fs.existsSync(userFile)) {
    return { ...base, ...readJson(userFile) };
  }
  return base;
}

export function setField(userId, field, rawValue) {
  const spec = FIELDS[field];
  if (!spec) {
    throw new Error(`I don't have a setting called "${field}".`);
  }
  let value = rawValue.trim();
  if (spec.type === "number") {
    const n = Number(value);
    if (!Number.isInteger(n) || n < 1 || n > 10) {
      throw new Error(`${field} needs a whole number from 1 to 10.`);
    }
    value = n;
  } else if (spec.type === "list") {
    value = value.split(",").map((s) => s.trim()).filter(Boolean);
  } else if (value.length > 300) {
    throw new Error("Please keep that under 300 characters.");
  }

  fs.mkdirSync(USERS_DIR, { recursive: true });
  const userFile = path.join(USERS_DIR, `${userId}.json`);
  const current = fs.existsSync(userFile) ? readJson(userFile) : {};
  current[field] = value;
  fs.writeFileSync(userFile, JSON.stringify(current, null, 2));
  return loadProfile(userId);
}

export function resetProfile(userId) {
  const userFile = path.join(USERS_DIR, `${userId}.json`);
  if (fs.existsSync(userFile)) fs.unlinkSync(userFile);
  return loadProfile(userId);
}

function describeLevel(n, low, high) {
  if (n <= 3) return low;
  if (n >= 8) return high;
  return `somewhere between ${low} and ${high}`;
}

// Turns a profile into instructions for Claude.
export function buildSystemPrompt(profile, speakerName) {
  return [
    `You are ${profile.name}, an AI friend who hangs out with ${speakerName} on Discord and plays co-op, non-competitive games with them.`,
    `Character: ${profile.character}.`,
    `Personality: ${profile.personality}.`,
    `Kindness (${profile.kindness}/10): be ${describeLevel(profile.kindness, "blunt and teasing, but never cruel", "warm, encouraging and supportive")}.`,
    `Humor (${profile.humor}/10): be ${describeLevel(profile.humor, "mostly serious", "playful and joking often")}.`,
    `Talkativeness (${profile.talkativeness}/10): keep replies ${describeLevel(profile.talkativeness, "very short, one or two sentences", "lively and a few sentences long")}.`,
    `Gamer skill (${profile.gamerSkill}/10): talk about games like ${describeLevel(profile.gamerSkill, "an enthusiastic beginner who is still learning", "an experienced expert who knows advanced strategies")}.`,
    `Favorite games: ${(profile.favoriteGames || []).join(", ") || "none yet"}.`,
    profile.extraNotes ? `Extra notes from your owner: ${profile.extraNotes}` : "",
    "",
    "How to talk:",
    "- Chat like a real friend in a Discord channel: casual, natural, no bullet lists or headings unless asked.",
    "- Stay in character, but if someone sincerely asks whether you are an AI, say yes.",
    "- You can play Minecraft (Java edition) with people when they invite you with '!friend mc join'. Other games (ARK, ASKA and more) are coming later; for those, help plan or talk strategy.",
    "- If someone seems upset or unsafe, be kind and encourage them to talk to someone they trust.",
    "- Several people may be in the channel. Messages are shown as 'Name: message'.",
  ]
    .filter((line) => line !== "")
    .join("\n");
}
