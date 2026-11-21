// Lets the AI friend join a Minecraft Java server as a real player.
// It can follow you, come to you, gather blocks, fight hostile mobs and
// chat in game. Claude decides which action to take from what you say.
import mineflayer from "mineflayer";
import pathfinderPkg from "mineflayer-pathfinder";
import pvpPkg from "mineflayer-pvp";
import collectPkg from "mineflayer-collectblock";

const { pathfinder, Movements, goals } = pathfinderPkg;

// Newest Minecraft Java version the bot toolkit can play.
export const LATEST_VERSION = mineflayer.testedVersions[mineflayer.testedVersions.length - 1];

let bot = null; // the Minecraft player, when connected
let state = {
  skill: 5,
  ownerName: null, // Minecraft name of the person who invited the friend
  guarding: false,
  onChat: null, // (mcUsername, message) => Promise<string | null>
  log: () => {}, // posts status lines to Discord
};

export function isConnected() {
  return Boolean(bot?.entity);
}

// ---------- Connecting ----------

export function connect({ host, port, username, auth, version, skill, ownerName, onChat, log }) {
  if (bot) disconnect();
  state = { ...state, skill: clampSkill(skill), ownerName, onChat, log: log || (() => {}), guarding: false };

  return new Promise((resolve, reject) => {
    const b = mineflayer.createBot({
      host,
      port: Number(port) || 25565,
      username,
      auth, // "microsoft" for real accounts, "offline" for servers with online-mode off
      version: version || false, // false = detect automatically
      onMsaCode: (data) => {
        state.log(
          `🔑 To log the friend into its Minecraft account, open ${data.verification_uri} and enter the code **${data.user_code}**. You only need to do this once.`
        );
      },
    });
    bot = b;

    b.loadPlugin(pathfinder);
    b.loadPlugin(pvpPkg.plugin);
    b.loadPlugin(collectPkg.plugin);

    const timeout = setTimeout(() => reject(new Error("Timed out joining the server.")), 5 * 60 * 1000);

    b.once("spawn", () => {
      clearTimeout(timeout);
      applySkill();
      resolve();
    });

    b.on("chat", (username, message) => handleChat(username, message));
    b.on("whisper", (username, message) => handleChat(username, message, true));

    b.on("death", () => state.log("💀 I died in Minecraft! Respawning..."));
    b.on("kicked", (reason) => {
      clearTimeout(timeout);
      const text = typeof reason === "string" ? reason : JSON.stringify(reason);
      state.log(`👢 I got kicked from the Minecraft server: ${text.slice(0, 300)}`);
      reject(new Error(`Kicked: ${text.slice(0, 300)}`));
    });
    b.on("error", (err) => {
      clearTimeout(timeout);
      console.error("Minecraft error:", err);
      reject(err);
    });
    b.on("end", () => {
      if (bot === b) bot = null;
    });

    // Guard mode: defend against hostile mobs near the owner.
    b.on("physicsTick", () => {
      if (!state.guarding || b.pvp.target) return;
      const mob = nearestHostile(guardRadius());
      if (mob) setTimeout(() => b.pvp?.attack(mob), reactionDelay());
    });
  });
}

export function disconnect() {
  if (bot) {
    try {
      bot.quit();
    } catch {}
  }
  bot = null;
}

export function setSkill(skill) {
  state.skill = clampSkill(skill);
  if (bot) applySkill();
}

export function setOwner(name) {
  if (name) state.ownerName = name;
}

// ---------- Gamer skill ----------
// 1 = clumsy newbie, 10 = pro. Changes movement, reaction time and fighting.

function clampSkill(n) {
  const v = Number(n);
  return Number.isFinite(v) ? Math.min(10, Math.max(1, Math.round(v))) : 5;
}

function reactionDelay() {
  return (11 - state.skill) * 120; // 1200 ms at skill 1, 120 ms at skill 10
}

function guardRadius() {
  return 6 + state.skill; // pros notice mobs from further away
}

function applySkill() {
  const moves = new Movements(bot);
  moves.allowSprinting = state.skill >= 4;
  moves.allowParkour = state.skill >= 6;
  moves.canDig = true;
  moves.allow1by1towers = state.skill >= 5;
  bot.pathfinder.setMovements(moves);
  bot.pvp.attackRange = state.skill >= 7 ? 3.5 : 3;
  bot.pvp.followRange = state.skill >= 7 ? 2 : 3;
}

// ---------- Chat in game ----------

async function handleChat(username, message, isWhisper = false) {
  if (!bot || username === bot.username || !state.onChat) return;
  const mentioned = message.toLowerCase().includes(bot.username.toLowerCase());
  const fromOwner = username === state.ownerName;
  // Answer the owner, anyone who whispers, or anyone who says the friend's name.
  if (!fromOwner && !mentioned && !isWhisper) return;
  try {
    const reply = await state.onChat(username, message);
    if (reply) sayInGame(reply);
  } catch (err) {
    console.error("Minecraft chat error:", err);
  }
}

export function sayInGame(text) {
  if (!bot) return;
  // Minecraft chat is one line and max 256 characters per message.
  const clean = text.replace(/\s+/g, " ").replace(/[*_`#]/g, "").trim();
  const parts = clean.match(/.{1,240}(\s|$)/g) || [];
  parts.slice(0, 3).forEach((part, i) => setTimeout(() => bot?.chat(part.trim()), i * 700));
}

// ---------- What the friend can see ----------

function player(name) {
  return bot?.players?.[name]?.entity || null;
}

function targetPlayer(name) {
  return player(name) || player(state.ownerName) || bot?.nearestEntity((e) => e.type === "player");
}

function nearestHostile(radius) {
  const center = player(state.ownerName)?.position || bot.entity.position;
  return bot.nearestEntity(
    (e) => e.type === "hostile" && e.position.distanceTo(center) <= radius && e.position.distanceTo(bot.entity.position) <= radius + 4
  );
}

export function status() {
  if (!isConnected()) return "Not in Minecraft right now.";
  const p = bot.entity.position;
  const items = bot.inventory
    .items()
    .slice(0, 12)
    .map((i) => `${i.count} ${i.name}`)
    .join(", ");
  const doing = bot.pvp.target ? "fighting" : bot.pathfinder.isMoving() ? "moving" : "standing around";
  return [
    `In Minecraft as ${bot.username} at x=${Math.round(p.x)}, y=${Math.round(p.y)}, z=${Math.round(p.z)}.`,
    `Health ${Math.round(bot.health)}/20, food ${Math.round(bot.food)}/20. Currently ${doing}${state.guarding ? ", guarding" : ""}.`,
    `Time: ${bot.time.isDay ? "day" : "night"}. Players online: ${Object.keys(bot.players).filter((n) => n !== bot.username).join(", ") || "none"}.`,
    `Inventory: ${items || "empty"}.`,
  ].join(" ");
}

// ---------- Actions Claude can choose ----------

export const TOOLS = [
  {
    name: "follow_player",
    description: "Follow a player around in Minecraft until told to stop.",
    input_schema: {
      type: "object",
      properties: { player: { type: "string", description: "Minecraft username. Leave empty for the person you're talking to." } },
      additionalProperties: false,
    },
  },
  {
    name: "come_to_player",
    description: "Walk to where a player is standing, then stop.",
    input_schema: {
      type: "object",
      properties: { player: { type: "string", description: "Minecraft username. Leave empty for the person you're talking to." } },
      additionalProperties: false,
    },
  },
  {
    name: "stop",
    description: "Stop moving, following, fighting, guarding and gathering.",
    input_schema: { type: "object", properties: {}, additionalProperties: false },
  },
  {
    name: "gather_blocks",
    description:
      "Find and mine blocks nearby and pick them up, e.g. oak_log, stone, coal_ore, iron_ore, dirt, sand. Use Minecraft block ids.",
    input_schema: {
      type: "object",
      properties: {
        block: { type: "string", description: "Minecraft block id, like oak_log or cobblestone" },
        count: { type: "integer", description: "How many blocks to mine, 1 to 32" },
      },
      required: ["block"],
      additionalProperties: false,
    },
  },
  {
    name: "guard",
    description: "Turn guard mode on or off. When on, attack hostile mobs (zombies, skeletons, creepers, spiders) that come near the player.",
    input_schema: {
      type: "object",
      properties: { on: { type: "boolean" } },
      required: ["on"],
      additionalProperties: false,
    },
  },
  {
    name: "attack_nearest_mob",
    description: "Attack the nearest hostile mob right now. Never attacks players.",
    input_schema: { type: "object", properties: {}, additionalProperties: false },
  },
  {
    name: "check_status",
    description: "Look at your own health, food, position, inventory, time of day and who is online.",
    input_schema: { type: "object", properties: {}, additionalProperties: false },
  },
];

// Runs one action. Returns a short text result for Claude.
export async function runTool(name, input, talkingTo) {
  if (!isConnected()) return "You are not in Minecraft right now.";
  const who = input?.player || talkingTo;
  await new Promise((r) => setTimeout(r, reactionDelay() / 2));

  switch (name) {
    case "follow_player": {
      const target = targetPlayer(who);
      if (!target) return `Can't see ${who || "anyone"} nearby. They may be too far away.`;
      bot.pvp.stop();
      bot.pathfinder.setGoal(new goals.GoalFollow(target, state.skill >= 7 ? 2 : 3), true);
      return `Now following ${target.username}.`;
    }
    case "come_to_player": {
      const target = targetPlayer(who);
      if (!target) return `Can't see ${who || "anyone"} nearby. They may be too far away.`;
      const p = target.position;
      bot.pathfinder.setGoal(new goals.GoalNear(p.x, p.y, p.z, 2));
      return `Walking to ${target.username}.`;
    }
    case "stop":
      state.guarding = false;
      bot.pvp.stop();
      bot.pathfinder.setGoal(null);
      Promise.resolve(bot.collectBlock?.cancelTask?.()).catch(() => {});
      return "Stopped everything.";
    case "gather_blocks":
      return gather(String(input.block || "").toLowerCase().replace(/^minecraft:/, ""), input.count);
    case "guard":
      state.guarding = Boolean(input.on);
      if (!state.guarding) bot.pvp.stop();
      return state.guarding ? "Guard mode on. Watching for hostile mobs." : "Guard mode off.";
    case "attack_nearest_mob": {
      const mob = nearestHostile(16);
      if (!mob) return "No hostile mobs nearby.";
      bot.pvp.attack(mob);
      return `Attacking a ${mob.name}.`;
    }
    case "check_status":
      return status();
    default:
      return `Unknown action ${name}.`;
  }
}

function gather(blockName, count) {
  const blockType = bot.registry.blocksByName[blockName];
  if (!blockType) return `"${blockName}" isn't a Minecraft block id. Try something like oak_log or stone.`;
  // Low skill gathers a bit less per trip; pros fill their pockets.
  const max = state.skill >= 7 ? 32 : state.skill >= 4 ? 16 : 8;
  const want = Math.min(Math.max(Number(count) || 8, 1), max);
  const found = bot.findBlocks({ matching: blockType.id, maxDistance: 32 + state.skill * 4, count: want });
  if (!found.length) return `Couldn't find any ${blockName} nearby.`;
  const targets = found.map((pos) => bot.blockAt(pos)).filter(Boolean);
  bot.pathfinder.setGoal(null);
  bot.collectBlock
    .collect(targets, { ignoreNoPath: true })
    .then(() => state.log(`⛏️ Finished gathering ${targets.length} ${blockName}.`))
    .catch((err) => console.error("Gathering stopped:", err.message));
  return `Started gathering ${targets.length} ${blockName}. This runs in the background.`;
}
