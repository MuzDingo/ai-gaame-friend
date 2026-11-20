// Hearing and speaking, using Deepgram (https://deepgram.com).
// Speech to text: turns what you say into words.
// Text to speech: turns the friend's reply into a voice.

const KEY = () => process.env.DEEPGRAM_API_KEY;
export const DEFAULT_VOICE = "aura-2-thalia-en";

// Deepgram Aura voices you can pick with "!friend set voice <name>".
export const VOICES = {
  feminine: ["thalia", "luna", "asteria", "athena", "aurora", "andromeda", "amalthea", "callista", "cora",
    "cordelia", "delia", "electra", "harmonia", "helena", "hera", "iris", "juno", "minerva", "ophelia",
    "pandora", "phoebe", "selene", "theia", "vesta"],
  masculine: ["orion", "apollo", "arcas", "aries", "atlas", "draco", "hermes", "hyperion", "janus",
    "jupiter", "mars", "neptune", "odysseus", "orpheus", "pluto", "saturn", "zeus"],
};

// Turns a short name like "luna" into Deepgram's full voice id.
export function resolveVoice(name) {
  const v = String(name || "").trim().toLowerCase();
  if (!v) return DEFAULT_VOICE;
  if (v.startsWith("aura-")) return v;
  return `aura-2-${v}-en`;
}

export function voiceEnabled() {
  return Boolean(KEY());
}

// pcm: raw audio from Discord (48 kHz, 2 channels, 16-bit).
export async function speechToText(pcm) {
  const url =
    "https://api.deepgram.com/v1/listen?model=nova-3&smart_format=true" +
    "&encoding=linear16&sample_rate=48000&channels=2";
  const res = await fetch(url, {
    method: "POST",
    headers: { Authorization: `Token ${KEY()}`, "Content-Type": "application/octet-stream" },
    body: pcm,
  });
  if (!res.ok) throw new Error(`Deepgram listen failed (${res.status}): ${await res.text()}`);
  const data = await res.json();
  return data?.results?.channels?.[0]?.alternatives?.[0]?.transcript?.trim() || "";
}

// Returns raw audio Discord can play (48 kHz, 2 channels, 16-bit).
export async function textToSpeech(text, voice) {
  const model = resolveVoice(voice);
  try {
    return await speak(text, model);
  } catch (err) {
    if (model === DEFAULT_VOICE) throw err;
    console.error(`Voice "${model}" didn't work, using ${DEFAULT_VOICE} instead.`, err.message);
    return speak(text, DEFAULT_VOICE);
  }
}

async function speak(text, model) {
  const url = `https://api.deepgram.com/v1/speak?model=${encodeURIComponent(model)}` +
    "&encoding=linear16&sample_rate=48000&container=none";
  const res = await fetch(url, {
    method: "POST",
    headers: { Authorization: `Token ${KEY()}`, "Content-Type": "application/json" },
    body: JSON.stringify({ text }),
  });
  if (!res.ok) throw new Error(`Deepgram speak failed (${res.status}): ${await res.text()}`);
  const mono = Buffer.from(await res.arrayBuffer());
  return monoToStereo(mono);
}

function monoToStereo(mono) {
  const samples = Math.floor(mono.length / 2);
  const stereo = Buffer.alloc(samples * 4);
  for (let i = 0; i < samples; i++) {
    const s = mono.readInt16LE(i * 2);
    stereo.writeInt16LE(s, i * 4);
    stereo.writeInt16LE(s, i * 4 + 2);
  }
  return stereo;
}
