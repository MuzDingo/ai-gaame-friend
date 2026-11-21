// The AI friend's Discord bot. Start it with: npm start
import "dotenv/config";
import { Client, GatewayIntentBits, Partials, ChannelType } from "discord.js";
import { loadProfile, setField, resetProfile, buildSystemPrompt, FIELDS } from "./profiles.js";
import { getReply, getReplyWithTools, streamReply } from "./brain.js";
import * as mc from "./minecraft.js";
import { joinVoice, leaveVoice, sayInVoice } from "./voice.js";
import { voiceEnabled, DEFAULT_VOICE, VOICES } from "./speech.js";
import { memoryPrompt, noteExchange, loadMemory, forgetUser, flushAll } from "./memory.js";

// Post what was heard and said in voice as text too? Off unless VOICE_TRANSCRIPTS=on.
const VOICE_TRANSCRIPTS = /^(on|true|yes|1)$/i.test(process.env.VOICE_TRANSCRIPTS || "");
// Optional faster model just for voice, e.g. claude-haiku-5-5.
const VOICE_MODEL = process.env.VOICE_MODEL || undefined;
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
    `\`${PREFIX} mc join <address>\`: join a Minecraft server (or \`${PREFIX} mc join <port>\` for your Open to LAN world)`,
    `\`${PREFIX} mc leave\` / \`${PREFIX} mc status\`: leave Minecraft or see what the friend is doing`,
    `\`${PREFIX} voices\`: list the voices you can pick`,
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
        syncMinecraftSettings(userId);
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
    case "voices":
      return message.reply([
        "**Voices** (set one with `" + PREFIX + " set voice luna`)",
        `**Feminine:** ${VOICES.feminine.join(", ")}`,
        `**Masculine:** ${VOICES.masculine.join(", ")}`,
        "Join voice and try a few to find your favorite!",
      ].join("\n"));
    case "mc":
    case "minecraft":
      return handleMinecraftCommand(message, [field, ...valueParts].filter(Boolean));
    case "join": {
      if (!message.guild) return message.reply("Voice chat only works in a server, not in DMs.");
      if (!voiceEnabled()) {
        return message.reply("Voice chat needs a DEEPGRAM_API_KEY in the .env file. See the README for how to get one.");
      }
      try {
        const channel = await joinVoice(message.member, message.channel, (speakerId, transcript, say) =>
          handleVoiceLine(message.guild, message.channel, speakerId, transcript, say));
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

// ---------- Minecraft ----------

const MC_RULES = [
  "",
  "You are in Minecraft right now, playing as a real player. Use your tools to act: follow, come over, gather blocks, guard against mobs, stop, or check your status.",
  "- When someone asks you to do something in the game, do it with a tool, then reply briefly like a gaming buddy would.",
  "- Never attack players. Only fight hostile mobs.",
  "- Your gamer skill setting already changes how well you move and fight, so don't pretend to be better or worse than you are.",
].join("\n");

let mcOwner = null; // { discordId, name, textChannel }

function minecraftContext() {
  return mc.isConnected() ? MC_RULES + "\nCurrent status: " + mc.status() : "";
}

// Gets a reply. When the friend is in Minecraft, it can also take actions there.
async function think(system, history, profile) {
  const messages = history.map((m) => ({ ...m }));
  if (!mc.isConnected()) return getReply(system, messages);
  const talkingTo = profile.minecraftName || null;
  return getReplyWithTools(system + minecraftContext(), messages, mc.TOOLS, (name, input) =>
    mc.runTool(name, input, talkingTo));
}

function parseAddress(arg) {
  const fallbackHost = process.env.MC_HOST || "localhost";
  const fallbackPort = process.env.MC_PORT || 25565;
  if (!arg) return { host: fallbackHost, port: fallbackPort };
  if (/^\d+$/.test(arg)) return { host: "localhost", port: Number(arg) }; // Open to LAN port
  const [host, port] = arg.split(":");
  return { host, port: Number(port) || 25565 };
}

async function handleMinecraftCommand(message, args) {
  const [sub, arg] = args;
  const userId = message.author.id;
  switch ((sub || "").toLowerCase()) {
    case "join": {
      if (!process.env.MC_USERNAME) {
        return message.reply("Add MC_USERNAME (the friend's Minecraft account email) to the .env file first. See the Minecraft section of the README.");
      }
      const profile = loadProfile(userId);
      const { host, port } = parseAddress(arg);
      await message.reply(`Joining Minecraft at **${host}:${port}**... ⛏️`);
      mcOwner = { discordId: userId, name: message.member?.displayName || message.author.username, textChannel: message.channel };
      try {
        await mc.connect({
          host,
          port,
          username: process.env.MC_USERNAME,
          auth: (process.env.MC_AUTH || "microsoft").toLowerCase(),
          version: process.env.MC_VERSION || false,
          skill: profile.gamerSkill,
          ownerName: profile.minecraftName,
          log: (text) => message.channel.send(text).catch(() => {}),
          onChat: handleMinecraftChat,
        });
        const hint = profile.minecraftName ? "" : `\nTip: tell me your Minecraft name with \`${PREFIX} set minecraftName YourName\` so I know which player is you.`;
        mc.sayInGame(`Hey! ${profile.name} here. Ready to play!`);
        return message.channel.send(`✅ I'm in! Talk to me in Minecraft chat, here, or in voice. Try "follow me" or "get some wood".${hint}`);
      } catch (err) {
        console.error("Minecraft join error:", err);
        const tooNew = err.message.match(/No data available for version (\S+)|unsupported protocol version/i);
        if (tooNew) {
          return message.channel.send(
            `❌ This world is on Minecraft **${tooNew[1] || "a newer version"}**, which I can't play yet. The newest version I support is **${mc.LATEST_VERSION}**. ` +
            "Play on that version for now (see \"Minecraft version\" in the README), or ask the server owner to add ViaVersion."
          );
        }
        return message.channel.send(`❌ Couldn't join Minecraft: ${err.message}`.slice(0, 1900));
      }
    }
    case "leave":
      mc.disconnect();
      return message.reply("Left Minecraft. GG!");
    case "status":
      return message.reply(mc.status());
    default:
      return message.reply(`Use \`${PREFIX} mc join <address>\`, \`${PREFIX} mc join <LAN port>\`, \`${PREFIX} mc leave\` or \`${PREFIX} mc status\`.`);
  }
}

// Someone talked to the friend in Minecraft chat.
async function handleMinecraftChat(mcName, text) {
  if (!mcOwner) return null;
  const profile = loadProfile(mcOwner.discordId);
  const historyKey = "minecraft";
  const history = remember(historyKey, "user", `${mcName} (in Minecraft chat): ${text}`);
  const system = buildSystemPrompt(profile, mcOwner.name) + memoryPrompt(mcOwner.discordId, mcOwner.name) +
    "\nYou are replying in Minecraft chat: one or two short sentences, no emojis or formatting.";
  const reply = await getReplyWithTools(system + minecraftContext(), history.map((m) => ({ ...m })), mc.TOOLS,
    (name, input) => mc.runTool(name, input, mcName));
  remember(historyKey, "assistant", reply);
  if (mcName === profile.minecraftName) noteExchange(mcOwner.discordId, mcOwner.name, text, reply);
  return reply;
}

// Keep the friend's gamer skill and Minecraft name in sync when the owner changes them.
function syncMinecraftSettings(userId) {
  if (!mcOwner || mcOwner.discordId !== userId) return;
  const p = loadProfile(userId);
  mc.setSkill(p.gamerSkill);
  mc.setOwner(p.minecraftName);
}

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
  if (VOICE_TRANSCRIPTS) textChannel.send(`🔊 **${profile.name}:** ${greeting}`).catch(() => {});
  await sayInVoice(guild.id, greeting, profile.voice || DEFAULT_VOICE);
}

// Called when someone finishes saying something in voice chat.
// say(sentence, voice) speaks one sentence; sentences are spoken as soon as they're ready.
async function handleVoiceLine(guild, textChannel, speakerId, transcript, say) {
  const member = await guild.members.fetch(speakerId).catch(() => null);
  if (!member || member.user.bot) return null;
  const speaker = member.displayName;
  const profile = loadProfile(speakerId);
  const voice = profile.voice || DEFAULT_VOICE;
  const history = remember(textChannel.id, "user", `${speaker} (voice): ${transcript}`);
  const system = buildSystemPrompt(profile, speaker) + memoryPrompt(speakerId, speaker) + VOICE_RULES;

  let reply;
  if (mc.isConnected()) {
    // In Minecraft the friend may need to act first, so it answers once the action is done.
    reply = await think(system, history, profile);
    say(reply, voice);
  } else {
    reply = await streamReply(system, history, (sentence) => say(sentence, voice), VOICE_MODEL);
  }
  remember(textChannel.id, "assistant", reply);
  noteExchange(speakerId, speaker, transcript, reply);
  if (VOICE_TRANSCRIPTS) {
    textChannel.send(`🎤 **${speaker}:** ${transcript}\n🔊 **${profile.name}:** ${reply}`).catch(() => {});
  }
  return null;
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
    const reply = await think(systemPrompt, history, profile);
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
  mc.disconnect();
  client.destroy();
  process.exit(0);
}
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);

client.login(process.env.DISCORD_TOKEN);
