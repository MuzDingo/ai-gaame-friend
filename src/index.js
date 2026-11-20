// The AI friend's Discord bot. Start it with: npm start
import "dotenv/config";
import { Client, GatewayIntentBits, Partials, ChannelType } from "discord.js";
import { loadProfile, setField, resetProfile, buildSystemPrompt, FIELDS } from "./profiles.js";
import { getReply } from "./brain.js";
import { joinVoice, leaveVoice, sayInVoice } from "./voice.js";
import { voiceEnabled, DEFAULT_VOICE } from "./speech.js";
import { memoryPrompt, noteExchange, loadMemory, forgetUser, flushAll } from "./memory.js";

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
    GatewayIntentBits.GuildVoiceStates, // needed for voice chat
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
    `\`${PREFIX} memories\`: see what your friend remembers about you`,
    `\`${PREFIX} forgetme\`: erase everything your friend remembers about you`,
    `\`${PREFIX} join\`: join the voice channel you're in and talk out loud`,
    `\`${PREFIX} leave\`: leave the voice channel`,
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
    case "memories": {
      const { facts } = loadMemory(userId);
      if (!facts.length) return message.reply("I don't have any memories about you saved yet. Let's chat more! (I save them every few messages.)");
      const list = facts.map((f) => `• ${f}`).join("\n");
      return message.reply(`Here's what I remember about you:\n${list}`.slice(0, 1900));
    }
    case "forgetme":
      forgetUser(userId);
      return message.reply("Done. I've erased everything I remembered about you. Fresh start!");
    case "join": {
      if (!message.guild) return message.reply("Voice chat only works in a server, not in DMs.");
      if (!voiceEnabled()) {
        return message.reply("Voice chat needs a DEEPGRAM_API_KEY in the .env file. See the README for how to get one.");
      }
      try {
        const channel = await joinVoice(message.member, message.channel, (speakerId, transcript) =>
          handleVoiceLine(message.guild, message.channel, speakerId, transcript));
        await message.reply(`Joined **${channel.name}**! Just talk, and I'll answer out loud. Type \`${PREFIX} leave\` when you're done.`);
        greetInVoice(message.guild, message.channel, message.member).catch((err) => console.error("Greeting error:", err));
        return;
      } catch (err) {
        console.error("Join error:", err);
        return message.reply(err.message.includes("voice channel first") ? err.message : "I couldn't join the voice channel. Check that I have permission to Connect and Speak there.");
      }
    }
    case "leave":
      return message.reply(message.guild && leaveVoice(message.guild.id) ? "Left the voice channel. Talk soon!" : "I'm not in a voice channel right now.");
    case "forget":
      histories.delete(message.channel.id);
      return message.reply("Fresh start! I've cleared our recent chat here.");
    default:
      return message.reply(helpText());
  }
}

const VOICE_RULES = [
  "",
  "You are talking out loud in a Discord voice channel right now. Your reply will be read aloud by a text-to-speech voice:",
  "- Keep it short and conversational, usually one to three sentences.",
  "- No emojis, markdown, lists, links or special symbols. Write numbers the way you'd say them.",
  "- The words you hear come from speech recognition and may have small mistakes. Guess the meaning instead of pointing them out.",
].join("\n");

// Says hello out loud right after joining a voice channel.
async function greetInVoice(guild, textChannel, member) {
  const speaker = member.displayName;
  const profile = loadProfile(member.id);
  let greeting = (profile.greeting || "").trim();
  if (!greeting) {
    const system = buildSystemPrompt(profile, speaker) + memoryPrompt(member.id, speaker) + VOICE_RULES;
    greeting = await getReply(system, [{
      role: "user",
      content: `(You just joined the voice channel because ${speaker} invited you. Say a short, natural hello in one or two sentences, in character. If you remember something about them, you can mention it.)`,
    }]);
  }
  remember(textChannel.id, "assistant", greeting);
  textChannel.send(`🔊 **${profile.name}:** ${greeting}`).catch(() => {});
  await sayInVoice(guild.id, greeting, profile.voice || DEFAULT_VOICE);
}

// Called when someone finishes saying something in voice chat.
async function handleVoiceLine(guild, textChannel, speakerId, transcript) {
  const member = await guild.members.fetch(speakerId).catch(() => null);
  if (!member || member.user.bot) return null;
  const speaker = member.displayName;
  const profile = loadProfile(speakerId);
  const history = remember(textChannel.id, "user", `${speaker} (voice): ${transcript}`);
  const system = buildSystemPrompt(profile, speaker) + memoryPrompt(speakerId, speaker) + VOICE_RULES;
  const reply = await getReply(system, history.map((m) => ({ ...m })));
  remember(textChannel.id, "assistant", reply);
  noteExchange(speakerId, speaker, transcript, reply);
  // Also post the conversation as text, so testers can see what was heard.
  textChannel.send(`🎤 **${speaker}:** ${transcript}\n🔊 **${profile.name}:** ${reply}`).catch(() => {});
  return { reply, voice: profile.voice || DEFAULT_VOICE };
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
  const systemPrompt = buildSystemPrompt(profile, speaker) + memoryPrompt(message.author.id, speaker);

  try {
    await message.channel.sendTyping();
    const reply = await getReply(systemPrompt, history.map((m) => ({ ...m })));
    remember(message.channel.id, "assistant", reply);
    noteExchange(message.author.id, speaker, cleaned, reply);
    const [first, ...rest] = splitForDiscord(reply);
    await message.reply(first);
    for (const part of rest) await message.channel.send(part);
  } catch (err) {
    console.error("Error getting a reply:", err);
    await message.reply("Oops, my brain glitched for a second. Try again in a moment?");
  }
});

// Save memories before shutting down (Ctrl + C).
let shuttingDown = false;
async function shutdown() {
  if (shuttingDown) process.exit(0);
  shuttingDown = true;
  console.log("Saving memories before shutting down...");
  await flushAll();
  client.destroy();
  process.exit(0);
}
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);

client.login(process.env.DISCORD_TOKEN);
