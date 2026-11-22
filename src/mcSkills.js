// Extra Minecraft skills for the AI friend: survival basics, sharing items,
// chests, crafting, smelting, places, sleeping, farming, animals and building.
// Each skill is an "action" Claude can choose, plus a few automatic habits
// (eating, wearing armor, coming back after dying).
import fs from "node:fs";
import path from "node:path";
import vec3Pkg from "vec3";
import pathfinderPkg from "mineflayer-pathfinder";

const { goals } = pathfinderPkg;
const Vec3 = vec3Pkg.Vec3 || vec3Pkg;
const PLACES_FILE = path.resolve("data/minecraft-places.json");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ---------- Small helpers ----------

function itemId(bot, name) {
  return bot.registry.itemsByName[clean(name)]?.id;
}

function clean(name) {
  return String(name || "").toLowerCase().trim().replace(/^minecraft:/, "").replace(/\s+/g, "_");
}

function countItem(bot, name) {
  const id = itemId(bot, name);
  return bot.inventory.items().filter((i) => i.type === id).reduce((n, i) => n + i.count, 0);
}

function findItem(bot, test) {
  return bot.inventory.items().find(test);
}

async function goNear(bot, pos, range = 2) {
  await bot.pathfinder.goto(new goals.GoalNear(pos.x, pos.y, pos.z, range));
}

function nearestBlock(bot, test, maxDistance = 32) {
  return bot.findBlock({ matching: (b) => b && test(b), maxDistance });
}

// Finds a free spot next to the friend where a block can be placed on top of solid ground.
function freeSpotNearby(bot) {
  const base = bot.entity.position.floored();
  const offsets = [
    [1, 0, 0], [-1, 0, 0], [0, 0, 1], [0, 0, -1], [1, 0, 1], [-1, 0, -1], [1, 0, -1], [-1, 0, 1],
    [2, 0, 0], [-2, 0, 0], [0, 0, 2], [0, 0, -2],
  ];
  for (const [dx, dy, dz] of offsets) {
    const pos = base.offset(dx, dy, dz);
    const here = bot.blockAt(pos);
    const below = bot.blockAt(pos.offset(0, -1, 0));
    if (here && here.name === "air" && below && below.boundingBox === "block") return below;
  }
  return null;
}

async function placeItemNearby(bot, itemName) {
  const item = findItem(bot, (i) => i.name === itemName);
  if (!item) return null;
  const ground = freeSpotNearby(bot);
  if (!ground) return null;
  await bot.equip(item, "hand");
  await bot.placeBlock(ground, new Vec3(0, 1, 0));
  return bot.blockAt(ground.position.offset(0, 1, 0));
}

// ---------- Automatic habits ----------

const WEAPONS = ["netherite_sword", "diamond_sword", "netherite_axe", "diamond_axe", "iron_sword", "iron_axe",
  "stone_sword", "stone_axe", "golden_sword", "wooden_sword", "golden_axe", "wooden_axe"];

export async function equipBestWeapon(bot) {
  for (const name of WEAPONS) {
    const item = findItem(bot, (i) => i.name === name);
    if (item) {
      await bot.equip(item, "hand").catch(() => {});
      return name;
    }
  }
  return null;
}

let eating = false;
async function eatIfHungry(bot, log) {
  if (eating || bot.food >= 15) return;
  const foods = bot.registry.foodsByName || {};
  const bad = ["rotten_flesh", "spider_eye", "poisonous_potato", "pufferfish", "suspicious_stew", "chorus_fruit"];
  const options = bot.inventory
    .items()
    .filter((i) => foods[i.name] && !bad.includes(i.name))
    .sort((a, b) => (foods[b.name].foodPoints || 0) - (foods[a.name].foodPoints || 0));
  if (!options.length) {
    if (bot.food <= 6) log("🍖 I'm getting really hungry and I don't have any food!");
    return;
  }
  eating = true;
  try {
    const held = bot.heldItem;
    await bot.equip(options[0], "hand");
    await bot.consume();
    if (held) await bot.equip(held, "hand").catch(() => {});
  } catch {
    // interrupted (for example by taking damage); try again next time
  } finally {
    eating = false;
  }
}

// Called once after joining. `ctx` gives access to the friend's state.
export function attachHabits(bot, ctx) {
  bot.on("health", () => eatIfHungry(bot, ctx.log));
  bot.on("spawn", () => {
    if (!ctx.state.diedRecently) return;
    ctx.state.diedRecently = false;
    // Head back to whoever it was following.
    const name = ctx.state.following;
    setTimeout(() => {
      const target = name && bot.players[name]?.entity;
      if (target) {
        bot.pathfinder.setGoal(new goals.GoalFollow(target, 3), true);
        bot.chat("I'm back! Coming to you.");
      } else if (name) {
        bot.chat(`I respawned, but I can't see you from here, ${name}. Where are you?`);
      }
    }, 1500);
  });
  bot.on("death", () => {
    ctx.state.diedRecently = true;
  });
}

// ---------- Places ----------

function loadPlaces() {
  try {
    return JSON.parse(fs.readFileSync(PLACES_FILE, "utf8"));
  } catch {
    return {};
  }
}

function savePlaces(all) {
  fs.mkdirSync(path.dirname(PLACES_FILE), { recursive: true });
  fs.writeFileSync(PLACES_FILE, JSON.stringify(all, null, 2));
}

// ---------- Crafting ----------

async function craft(bot, name, amount, log) {
  const id = itemId(bot, name);
  if (!id) return `"${name}" isn't a Minecraft item id. Try something like oak_planks, stick, wooden_pickaxe or torch.`;
  const want = Math.min(Math.max(Number(amount) || 1, 1), 64);

  // Try without a crafting table first (2x2 recipes like planks and sticks).
  let recipe = bot.recipesFor(id, null, 1, null)[0];
  let table = null;
  const needsTable = !recipe && bot.recipesAll(id, null, null).length === 0;
  if (!recipe && !needsTable) return missingIngredients(bot, id, name, null);
  if (!recipe) {
    table = nearestBlock(bot, (b) => b.name === "crafting_table", 24);
    if (!table && countItem(bot, "crafting_table") === 0) {
      // Make a crafting table if possible.
      const planks = bot.inventory.items().find((i) => i.name.endsWith("_planks") && i.count >= 4);
      const tableRecipe = bot.recipesFor(itemId(bot, "crafting_table"), null, 1, null)[0];
      if (planks && tableRecipe) await bot.craft(tableRecipe, 1, null);
    }
    if (!table && countItem(bot, "crafting_table") > 0) table = await placeItemNearby(bot, "crafting_table");
    if (!table) return `I need a crafting table to make ${name}, and I don't have one or the planks to make one.`;
    await goNear(bot, table.position, 2);
    recipe = bot.recipesFor(id, null, 1, table)[0];
  }
  if (!recipe) return missingIngredients(bot, id, name, table);
  const perCraft = recipe.result?.count || 1;
  const times = Math.ceil(want / perCraft);
  let made = 0;
  for (let i = 0; i < times; i++) {
    const r = bot.recipesFor(id, null, 1, table)[0];
    if (!r) break;
    try {
      await bot.craft(r, 1, table);
    } catch (err) {
      if (!made) return `Crafting ${name} failed: ${err.message}`;
      break;
    }
    made += perCraft;
  }
  if (!made) return `I couldn't craft ${name}.`;
  log?.(`🛠️ Crafted ${made} ${name}.`);
  return `Crafted ${made} ${name}${made < want ? ` (ran out of ingredients after ${made})` : ""}.`;
}

function missingIngredients(bot, id, name, table) {
  const anyRecipe = bot.recipesAll(id, null, table || true)[0];
  if (!anyRecipe) return `I don't know a recipe for ${name}.`;
  const needs = (anyRecipe.delta || [])
    .filter((d) => d.count < 0)
    .map((d) => `${-d.count} ${bot.registry.items[d.id]?.name || d.id}`)
    .join(", ");
  return `I don't have the ingredients for ${name}. One craft needs: ${needs}. I have to gather or craft those first.`;
}

// ---------- Smelting ----------

const FUELS = ["coal", "charcoal", "coal_block", "oak_planks", "spruce_planks", "birch_planks", "jungle_planks",
  "acacia_planks", "dark_oak_planks", "mangrove_planks", "cherry_planks", "oak_log", "spruce_log", "birch_log", "stick"];

async function smelt(bot, name, amount, log) {
  const input = findItem(bot, (i) => i.name === clean(name));
  if (!input) return `I don't have any ${name} to smelt.`;
  const fuel = FUELS.map((f) => findItem(bot, (i) => i.name === f)).find(Boolean);
  if (!fuel) return "I don't have any fuel (coal, charcoal, planks or logs).";

  let furnace = nearestBlock(bot, (b) => b.name === "furnace", 24);
  if (!furnace && countItem(bot, "furnace") === 0 && countItem(bot, "cobblestone") >= 8) {
    await craft(bot, "furnace", 1);
  }
  if (!furnace && countItem(bot, "furnace") > 0) furnace = await placeItemNearby(bot, "furnace");
  if (!furnace) return "I need a furnace. I don't have one, or 8 cobblestone to make one.";

  const count = Math.min(Math.max(Number(amount) || input.count, 1), countItem(bot, input.name), 64);
  await goNear(bot, furnace.position, 2);
  const f = await bot.openFurnace(furnace);
  try {
    const fuelNeeded = Math.max(1, Math.ceil(count / (fuel.name.includes("coal") ? 8 : 1.5)));
    await f.putFuel(fuel.type, null, Math.min(fuelNeeded, fuel.count));
    await f.putInput(input.type, null, count);
  } catch (err) {
    f.close();
    return `Couldn't load the furnace: ${err.message}`;
  }
  // Smelting takes 10 seconds per item. Collect the results in the background.
  (async () => {
    let collected = 0;
    const deadline = Date.now() + count * 10_500 + 5_000;
    while (Date.now() < deadline && collected < count) {
      await sleep(3000);
      if (f.outputItem()) {
        const out = await f.takeOutput().catch(() => null);
        if (out) collected += out.count;
      }
    }
    f.close();
    log?.(`🔥 Finished smelting: got ${collected} items from ${name}.`);
  })().catch((err) => console.error("Smelting stopped:", err.message));
  return `Smelting ${count} ${name}. That takes about ${Math.ceil(count * 10)} seconds. I'll grab the results when it's done.`;
}

// ---------- Farming ----------

const CROPS = {
  wheat: { mature: 7, seed: "wheat_seeds" },
  carrots: { mature: 7, seed: "carrot" },
  potatoes: { mature: 7, seed: "potato" },
  beetroots: { mature: 3, seed: "beetroot_seeds" },
};

async function farm(bot, log) {
  const mature = bot.findBlocks({
    matching: (b) => b && CROPS[b.name] && b.getProperties?.().age >= CROPS[b.name].mature,
    maxDistance: 24,
    count: 32,
  });
  if (!mature.length) return "No grown crops nearby to harvest.";
  (async () => {
    let harvested = 0;
    for (const pos of mature) {
      const block = bot.blockAt(pos);
      if (!block || !CROPS[block.name]) continue;
      const crop = CROPS[block.name];
      try {
        await goNear(bot, pos, 2);
        await bot.dig(block);
        harvested++;
        await sleep(300);
        const soil = bot.blockAt(pos.offset(0, -1, 0));
        const seed = findItem(bot, (i) => i.name === crop.seed);
        if (soil?.name === "farmland" && seed) {
          await bot.equip(seed, "hand");
          await bot.placeBlock(soil, new Vec3(0, 1, 0)).catch(() => {});
        }
      } catch {}
    }
    await pickUpNearbyItems(bot, 8);
    log?.(`🌾 Harvested and replanted ${harvested} crops.`);
  })().catch((err) => console.error("Farming stopped:", err.message));
  return `Harvesting ${mature.length} grown crops and replanting them.`;
}

async function pickUpNearbyItems(bot, radius = 8) {
  for (let i = 0; i < 10; i++) {
    const drop = bot.nearestEntity((e) => e.name === "item" && e.position.distanceTo(bot.entity.position) <= radius);
    if (!drop) return;
    await goNear(bot, drop.position, 0).catch(() => {});
    await sleep(250);
  }
}

// ---------- Animals ----------

const BREED_FOOD = {
  cow: ["wheat"], mooshroom: ["wheat"], sheep: ["wheat"], goat: ["wheat"],
  pig: ["carrot", "potato", "beetroot"], chicken: ["wheat_seeds", "beetroot_seeds", "melon_seeds", "pumpkin_seeds"],
  rabbit: ["carrot", "dandelion"], horse: ["golden_apple", "golden_carrot"], wolf: ["beef", "porkchop", "chicken"],
  cat: ["cod", "salmon"], llama: ["hay_block"], turtle: ["seagrass"], fox: ["sweet_berries"], bee: ["dandelion", "poppy"],
};

async function breed(bot, animal) {
  const kind = clean(animal);
  const foods = BREED_FOOD[kind];
  if (!foods) return `I don't know how to breed ${animal}. I can breed: ${Object.keys(BREED_FOOD).join(", ")}.`;
  const food = foods.map((f) => findItem(bot, (i) => i.name === f)).find(Boolean);
  if (!food || food.count < 2) return `I need at least 2 ${foods[0]} to breed ${kind}s.`;
  const animals = Object.values(bot.entities)
    .filter((e) => e.name === kind && e.position.distanceTo(bot.entity.position) < 20)
    .sort((a, b) => a.position.distanceTo(bot.entity.position) - b.position.distanceTo(bot.entity.position))
    .slice(0, 2);
  if (animals.length < 2) return `I need two ${kind}s close by to breed them.`;
  for (const a of animals) {
    await goNear(bot, a.position, 2);
    await bot.equip(food, "hand");
    await bot.activateEntity(a);
    await sleep(400);
  }
  return `Fed two ${kind}s. A baby should pop out in a moment!`;
}

const HUNTABLE = ["cow", "pig", "chicken", "sheep", "rabbit", "mooshroom", "cod", "salmon"];

async function hunt(bot, animal, amount, log) {
  const kind = clean(animal || "");
  const allowed = kind ? [kind] : ["cow", "pig", "chicken", "sheep"];
  if (kind && !HUNTABLE.includes(kind)) return `I only hunt food animals: ${HUNTABLE.join(", ")}.`;
  const want = Math.min(Math.max(Number(amount) || 2, 1), 6);
  (async () => {
    let got = 0;
    for (let i = 0; i < want; i++) {
      const target = bot.nearestEntity((e) => allowed.includes(e.name) && e.position.distanceTo(bot.entity.position) < 32);
      if (!target) break;
      await equipBestWeapon(bot);
      bot.pvp.attack(target);
      const start = Date.now();
      while (bot.entities[target.id] && Date.now() - start < 20_000) await sleep(500);
      bot.pvp.stop();
      got++;
      await pickUpNearbyItems(bot, 6);
    }
    log?.(got ? `🍗 Hunted ${got} ${kind || "animals"} for food.` : `🍗 Couldn't find any ${kind || "food animals"} nearby.`);
  })().catch((err) => console.error("Hunting stopped:", err.message));
  return `Going hunting for ${want} ${kind || "food animals"}.`;
}

// ---------- Building ----------

const MAX_BUILD = { width: 9, length: 9, height: 5 };

function shapePositions(shape, origin, dir, width, length, height) {
  // dir: unit vector the owner is facing (x or z). side: perpendicular.
  const side = new Vec3(-dir.z, 0, dir.x);
  const out = [];
  const add = (f, s, y) => out.push(origin.plus(dir.scaled(f)).plus(side.scaled(s)).offset(0, y, 0));
  const half = Math.floor(width / 2);
  if (shape === "wall") {
    for (let y = 0; y < height; y++) for (let s = -half; s < width - half; s++) add(2, s, y);
  } else if (shape === "floor") {
    for (let f = 1; f <= length; f++) for (let s = -half; s < width - half; s++) add(f, s, -1);
  } else if (shape === "pillar") {
    for (let y = 0; y < height; y++) add(2, 0, y);
  } else if (shape === "shelter") {
    // Hollow box in front of the owner with a 1x2 doorway facing them, and a roof.
    for (let y = 0; y <= height; y++) {
      for (let f = 1; f <= length; f++) {
        for (let s = -half; s < width - half; s++) {
          const edge = f === 1 || f === length || s === -half || s === width - half - 1;
          const roof = y === height;
          const door = f === 1 && s === 0 && y < 2;
          if ((edge || roof) && !door) add(f, s, y);
        }
      }
    }
  }
  return out;
}

const FACES = [new Vec3(0, -1, 0), new Vec3(1, 0, 0), new Vec3(-1, 0, 0), new Vec3(0, 0, 1), new Vec3(0, 0, -1), new Vec3(0, 1, 0)];

async function placeAt(bot, pos, item) {
  const here = bot.blockAt(pos);
  if (!here || (here.name !== "air" && here.name !== "cave_air" && here.boundingBox !== "empty")) return false;
  for (const face of FACES) {
    const ref = bot.blockAt(pos.plus(face));
    if (ref && ref.boundingBox === "block") {
      if (bot.entity.position.distanceTo(pos) > 4) await goNear(bot, pos, 3).catch(() => {});
      // Don't place a block where the friend is standing.
      if (bot.entity.position.floored().equals(pos) || bot.entity.position.floored().offset(0, 1, 0).equals(pos)) {
        await goNear(bot, pos.offset(2, 0, 2), 1).catch(() => {});
      }
      await bot.equip(item, "hand");
      await bot.placeBlock(ref, face.scaled(-1));
      return true;
    }
  }
  return false;
}

async function build(bot, shape, blockName, width, length, height, ownerEntity, log) {
  const kind = clean(shape);
  if (!["wall", "floor", "pillar", "shelter"].includes(kind)) return "I can build: wall, floor, pillar or shelter.";
  const block = clean(blockName);
  const w = Math.min(Math.max(Number(width) || (kind === "pillar" ? 1 : 5), 1), MAX_BUILD.width);
  const l = Math.min(Math.max(Number(length) || 5, 3), MAX_BUILD.length);
  const h = Math.min(Math.max(Number(height) || 3, 1), MAX_BUILD.height);

  const anchor = ownerEntity || bot.entity;
  const yaw = anchor.yaw;
  // Turn the facing direction into the nearest of north/south/east/west.
  const dx = -Math.sin(yaw);
  const dz = -Math.cos(yaw);
  const dir = Math.abs(dx) > Math.abs(dz) ? new Vec3(Math.sign(dx), 0, 0) : new Vec3(0, 0, Math.sign(dz));
  const positions = shapePositions(kind, anchor.position.floored(), dir, w, l, h).sort((a, b) => a.y - b.y);

  const have = countItem(bot, block);
  if (!have) return `I don't have any ${block}. Give me some or ask me to gather it first.`;
  const note = have < positions.length ? ` I only have ${have} of the ${positions.length} blocks it needs, so I'll build as much as I can.` : "";

  (async () => {
    let placed = 0;
    for (const pos of positions) {
      const item = findItem(bot, (i) => i.name === block);
      if (!item) break;
      if (await placeAt(bot, pos, item).catch(() => false)) placed++;
    }
    log?.(`🧱 Built a ${kind} with ${placed} ${block}.`);
  })().catch((err) => console.error("Building stopped:", err.message));
  return `Building a ${w}x${kind === "shelter" || kind === "floor" ? l : h}${kind === "shelter" ? `x${h}` : ""} ${kind} out of ${block} in front of you.${note}`;
}

// ---------- The actions Claude can choose ----------

const obj = (properties, required = []) => ({ type: "object", properties, required, additionalProperties: false });
const str = (description) => ({ type: "string", description });
const int = (description) => ({ type: "integer", description });

export const SKILL_TOOLS = [
  {
    name: "give_items",
    description: "Walk to a player and drop items for them, e.g. give 10 cobblestone. Use Minecraft item ids.",
    input_schema: obj({ item: str("Item id like iron_ingot or bread"), count: int("How many, default all"), player: str("Leave empty for the person you're talking to") }, ["item"]),
  },
  {
    name: "store_in_chest",
    description: "Put items into the nearest chest or barrel. Use item 'all' to empty the whole inventory except tools, weapons, armor and food.",
    input_schema: obj({ item: str("Item id, or 'all'"), count: int("How many, default all") }, ["item"]),
  },
  {
    name: "take_from_chest",
    description: "Take items out of the nearest chest or barrel.",
    input_schema: obj({ item: str("Item id"), count: int("How many, default 16") }, ["item"]),
  },
  {
    name: "craft_item",
    description:
      "Craft an item. Uses or places a crafting table when needed. If ingredients are missing, the result says what's needed, so you can craft parts first (e.g. oak_planks, then stick, then wooden_pickaxe).",
    input_schema: obj({ item: str("Item id like stick, torch, stone_pickaxe, chest, furnace"), count: int("How many to make") }, ["item"]),
  },
  {
    name: "smelt_items",
    description: "Smelt items in a furnace (ores into ingots, raw food into cooked food, sand into glass). Uses or places a furnace.",
    input_schema: obj({ item: str("Input item id like raw_iron, beef, sand"), count: int("How many") }, ["item"]),
  },
  {
    name: "equip_best_weapon",
    description: "Hold the best sword or axe in your inventory.",
    input_schema: obj({}),
  },
  {
    name: "remember_place",
    description: "Save the current spot (or the player's spot) with a name like home, mine or farm, so you can go back later.",
    input_schema: obj({ name: str("Short name for the place"), at_player: { type: "boolean", description: "Save where the player is standing instead of where you are" } }, ["name"]),
  },
  {
    name: "go_to_place",
    description: "Walk to a saved place by name.",
    input_schema: obj({ name: str("Saved place name") }, ["name"]),
  },
  {
    name: "list_places",
    description: "List the places you remember on this server.",
    input_schema: obj({}),
  },
  {
    name: "go_to_coordinates",
    description: "Walk to x, y, z coordinates. y is optional.",
    input_schema: obj({ x: int("x"), y: int("y, optional"), z: int("z") }, ["x", "z"]),
  },
  {
    name: "sleep_in_bed",
    description: "Find a nearby bed and sleep in it. Only works at night or during thunderstorms.",
    input_schema: obj({}),
  },
  {
    name: "farm_crops",
    description: "Harvest fully grown wheat, carrots, potatoes and beetroots nearby, and replant them.",
    input_schema: obj({}),
  },
  {
    name: "breed_animals",
    description: "Feed two nearby animals of the same kind so they make a baby. Needs the right food in inventory.",
    input_schema: obj({ animal: str("cow, sheep, pig, chicken, rabbit, wolf, etc.") }, ["animal"]),
  },
  {
    name: "hunt_animals",
    description: "Hunt food animals (cow, pig, chicken, sheep, rabbit) and pick up what they drop.",
    input_schema: obj({ animal: str("Animal kind, or leave empty for any food animal"), count: int("How many, 1 to 6") }),
  },
  {
    name: "build",
    description:
      "Build a simple structure in front of the player from a block in your inventory: wall, floor, pillar, or shelter (a small hollow house with a doorway and roof).",
    input_schema: obj(
      {
        shape: { type: "string", enum: ["wall", "floor", "pillar", "shelter"] },
        block: str("Block id to build with, like cobblestone or oak_planks"),
        width: int("Width, up to 9"),
        length: int("Length for floor/shelter, up to 9"),
        height: int("Height for wall/pillar/shelter, up to 5"),
      },
      ["shape", "block"]
    ),
  },
];

const KEEP = /(sword|axe|pickaxe|shovel|hoe|helmet|chestplate|leggings|boots|shield|bow|crossbow|trident)$/;

// Runs one of the skills above. Returns a short text result for Claude.
export async function runSkill(name, input, { bot, state, log, targetPlayer, serverKey }) {
  switch (name) {
    case "give_items": {
      const target = targetPlayer(input.player);
      if (!target) return "I can't see you nearby. Come closer and ask again.";
      const id = itemId(bot, input.item);
      const have = id ? countItem(bot, input.item) : 0;
      if (!have) return `I don't have any ${input.item}.`;
      const count = Math.min(Number(input.count) || have, have);
      await goNear(bot, target.position, 2);
      await bot.lookAt(target.position.offset(0, 1.6, 0));
      await bot.toss(id, null, count);
      return `Tossed ${count} ${clean(input.item)} to ${target.username}.`;
    }
    case "store_in_chest": {
      const chest = nearestBlock(bot, (b) => ["chest", "barrel", "trapped_chest"].includes(b.name), 24);
      if (!chest) return "I can't find a chest or barrel nearby.";
      await goNear(bot, chest.position, 2);
      const window = await bot.openContainer(chest);
      let stored = 0;
      try {
        const all = clean(input.item) === "all";
        const foods = bot.registry.foodsByName || {};
        const items = bot.inventory.items().filter((i) => (all ? !KEEP.test(i.name) && !foods[i.name] : i.name === clean(input.item)));
        if (!items.length) return all ? "I don't have anything to store." : `I don't have any ${input.item}.`;
        let left = all ? Infinity : Number(input.count) || Infinity;
        for (const i of items) {
          if (left <= 0) break;
          const n = Math.min(i.count, left);
          await window.deposit(i.type, null, n).catch(() => {});
          stored += n;
          left -= n;
        }
      } finally {
        window.close();
      }
      return `Put ${stored} items in the ${chest.name}.`;
    }
    case "take_from_chest": {
      const chest = nearestBlock(bot, (b) => ["chest", "barrel", "trapped_chest"].includes(b.name), 24);
      if (!chest) return "I can't find a chest or barrel nearby.";
      const id = itemId(bot, input.item);
      if (!id) return `"${input.item}" isn't a Minecraft item id.`;
      await goNear(bot, chest.position, 2);
      const window = await bot.openContainer(chest);
      try {
        const inChest = window.containerItems().filter((i) => i.type === id).reduce((n, i) => n + i.count, 0);
        if (!inChest) return `There's no ${input.item} in that chest.`;
        const n = Math.min(Number(input.count) || 16, inChest);
        await window.withdraw(id, null, n);
        return `Took ${n} ${clean(input.item)} from the chest.`;
      } finally {
        window.close();
      }
    }
    case "craft_item":
      return craft(bot, input.item, input.count, log);
    case "smelt_items":
      return smelt(bot, input.item, input.count, log);
    case "equip_best_weapon": {
      const w = await equipBestWeapon(bot);
      return w ? `Holding my ${w}.` : "I don't have a sword or axe.";
    }
    case "remember_place": {
      const who = input.at_player ? targetPlayer(null) : bot.entity;
      if (!who) return "I can't see you, so I'll need to save my own spot instead.";
      const p = who.position;
      const all = loadPlaces();
      all[serverKey] = all[serverKey] || {};
      all[serverKey][clean(input.name)] = { x: Math.round(p.x), y: Math.round(p.y), z: Math.round(p.z), dimension: bot.game.dimension };
      savePlaces(all);
      return `Saved "${input.name}" at x=${Math.round(p.x)}, y=${Math.round(p.y)}, z=${Math.round(p.z)}.`;
    }
    case "go_to_place": {
      const place = loadPlaces()[serverKey]?.[clean(input.name)];
      if (!place) return `I don't remember a place called "${input.name}".`;
      bot.pathfinder.setGoal(new goals.GoalNear(place.x, place.y, place.z, 2));
      state.following = null;
      return `Heading to ${input.name} (x=${place.x}, y=${place.y}, z=${place.z}).`;
    }
    case "list_places": {
      const places = loadPlaces()[serverKey] || {};
      const names = Object.entries(places).map(([n, p]) => `${n} (${p.x}, ${p.y}, ${p.z})`);
      return names.length ? `Places I remember: ${names.join("; ")}.` : "I don't have any saved places yet.";
    }
    case "go_to_coordinates": {
      const { x, y, z } = input;
      bot.pathfinder.setGoal(y === undefined || y === null ? new goals.GoalXZ(x, z) : new goals.GoalNear(x, y, z, 2));
      state.following = null;
      return `Walking to x=${x}${y !== undefined && y !== null ? `, y=${y}` : ""}, z=${z}.`;
    }
    case "sleep_in_bed": {
      const bed = nearestBlock(bot, (b) => b.name.endsWith("_bed"), 32);
      if (!bed) return "I can't find a bed nearby.";
      await goNear(bot, bed.position, 2);
      try {
        await bot.sleep(bed);
        return "Zzz... sleeping in the bed. Good night!";
      } catch (err) {
        return `I can't sleep right now: ${err.message}`;
      }
    }
    case "farm_crops":
      return farm(bot, log);
    case "breed_animals":
      return breed(bot, input.animal);
    case "hunt_animals":
      return hunt(bot, input.animal, input.count, log);
    case "build":
      return build(bot, input.shape, input.block, input.width, input.length, input.height, targetPlayer(null), log);
    default:
      return null; // not one of these skills
  }
}
