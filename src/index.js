// The AI friend's Discord bot. Start it with: npm start
import "dotenv/config";
import { Client, GatewayIntentBits, Partials, ChannelType } from "discord.js";
import { loadProfile, setField, resetProfile, buildSystemPrompt, FIELDS } from "./profiles.js";
import { getReply } from "./brain.js";

const PREFIX = (process.env.COMMAND_PREFIX || "!friend").toLowerCase();
const HISTORY_LENGTH = Number(process.env.HISTORY_LENGTH) || 20;
// Optional: channel IDs (comma separated) where the friend replies to every message.
// Everywhere else it replies only when @mentioned or in a direct message.
const OPEN_CHANNELS = (process.env.FRIEND_CHANNEL_IDS || "")
  .split(",").map((s) => s.trim()).filter(Boolean);

if (!process.env.DISCORD_TOKEN || !process.env.ANTHROPIC_API_KEY) {
  console.error("Missing DISCORD_TOKEN or ANTHROPIC_API_KEY. Copy .env.example to .env and fill them in.");
  process.exit(1);
}

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.DirectMessages,
  ],
  partials: [Partials.Channel], // needed to receive direct messages
});

// Recent messages per channel: [{ role: "user" | "assistant", content }]
const histories = new Map();

function remember(channelId, role, content) {
  const list = histories.get(channelId) || [];
  const last = list[list.length - 1];
  if (last && last.role === role) {
    last.content += `\n${content}`; // Claude needs user and assistant turns to alternate
  } else {
    list.push({ role, content });
  }
  while (list.length > HISTORY_LENGTH) list.shift();
  while (list.length && list[0].role !== "user") list.shift(); // must start with a user turn
  histories.set(channelId, list);
  return list;
}

function splitForDiscord(text, max = 1900) {
  const parts = [];
  let rest = text;
  while (rest.length > max) {
    let cut = rest.lastIndexOf("\n", max);
    if (cut < max / 2) cut = rest.lastIndexOf(" ", max);
    if (cut < max / 2) cut = max;
    parts.push(rest.slice(0, cut));
    rest = rest.slice(cut).trimStart();
  }
  parts.push(rest);
  return parts;
}

function showProfile(profile) {
  return [
    `**${profile.name}**`,
    ...Object.keys(FIELDS)
      .filter((f) => f !== "name")
      .map((f) => {
        const v = Array.isArray(profile[f]) ? profile[f].join(", ") : profile[f];
        return `• **${f}**: ${v === "" || v === undefined ? "(none)" : v}`;
      }),
  ].join("\n");
}

function helpText() {
  return [
    "**Customize your AI friend**",
    `\`${PREFIX} show\`: see your friend's current settings`,
    `\`${PREFIX} set <setting> <value>\`: change a setting, e.g. \`${PREFIX} set kindness 9\``,
    `\`${PREFIX} reset\`: go back to the default friend`,
    `\`${PREFIX} forget\`: clear the recent chat in this channel`,
    "",
    "**Settings**",
    ...Object.entries(FIELDS).map(([f, s]) => `• **${f}**: ${s.help}`),
  ].join("\n");
}

async function handleCommand(message, args) {
  const [sub, field, ...valueParts] = args;
  const userId = message.author.id;
  switch ((sub || "help").toLowerCase()) {
    case "show":
      return message.reply(showProfile(loadProfile(userId)));
    case "set": {
      if (!field || !valueParts.length) {
        return message.reply(`Try something like \`${PREFIX} set name Nova\`. Type \`${PREFIX} help\` for all settings.`);
      }
      try {
        const updated = setField(userId, field, valueParts.join(" "));
        return message.reply(`Done! **${field}** is now **${[].concat(updated[field]).join(", ")}**.`);
      } catch (err) {
        return message.reply(err.message);
      }
    }
    case "reset":
      resetProfile(userId);
      return message.reply("Your friend is back to the default settings.");
    case "forget":
      histories.delete(message.channel.id);
      return message.reply("Fresh start! I've cleared our recent chat here.");
    default:
      return message.reply(helpText());
  }
}

client.once("ready", () => {
  console.log(`✅ Your AI friend is online as ${client.user.tag}`);
});

client.on("messageCreate", async (message) => {
  if (message.author.bot) return;

  const text = message.content.trim();
  if (text.toLowerCase().startsWith(PREFIX)) {
    return handleCommand(message, text.slice(PREFIX.length).trim().split(/\s+/).filter(Boolean));
  }

  const isDM = message.channel.type === ChannelType.DM;
  const mentioned = message.mentions.has(client.user);
  const openChannel = OPEN_CHANNELS.includes(message.channel.id);
  if (!isDM && !mentioned && !openChannel) return;

  const speaker = message.member?.displayName || message.author.username;
  const cleaned = text.replace(new RegExp(`<@!?${client.user.id}>`, "g"), "").trim() || "(says hi)";
  const history = remember(message.channel.id, "user", `${speaker}: ${cleaned}`);

  // The person who spoke picks which custom friend answers them.
  const profile = loadProfile(message.author.id);
  const systemPrompt = buildSystemPrompt(profile, speaker);

  try {
    await message.channel.sendTyping();
    const reply = await getReply(systemPrompt, history.map((m) => ({ ...m })));
    remember(message.channel.id, "assistant", reply);
    const [first, ...rest] = splitForDiscord(reply);
    await message.reply(first);
    for (const part of rest) await message.channel.send(part);
  } catch (err) {
    console.error("Error getting a reply:", err);
    await message.reply("Oops, my brain glitched for a second. Try again in a moment?");
  }
});

client.login(process.env.DISCORD_TOKEN);
