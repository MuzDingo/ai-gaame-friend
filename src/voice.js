// Lets the friend join a Discord voice channel, listen, and talk back.
import { Readable } from "node:stream";
import prism from "prism-media";
import {
  joinVoiceChannel, getVoiceConnection, createAudioPlayer, createAudioResource,
  StreamType, AudioPlayerStatus, EndBehaviorType, entersState, VoiceConnectionStatus,
} from "@discordjs/voice";
import { speechToText, textToSpeech } from "./speech.js";

// Ignore clips shorter than this (coughs, clicks). 48000 Hz * 2 ch * 2 bytes = 192000 bytes/sec.
const MIN_AUDIO_BYTES = 192000 * 0.5;
const SILENCE_MS = Number(process.env.VOICE_SILENCE_MS) || 700;

const sessions = new Map(); // guildId -> session

// onSpeech(userId, transcript) must return { reply, voice } or null.
export async function joinVoice(member, textChannel, onSpeech) {
  const channel = member.voice?.channel;
  if (!channel) throw new Error("Hop into a voice channel first, then ask me to join.");

  leaveVoice(channel.guild.id);
  const connection = joinVoiceChannel({
    channelId: channel.id,
    guildId: channel.guild.id,
    adapterCreator: channel.guild.voiceAdapterCreator,
    selfDeaf: false,
    selfMute: false,
  });
  await entersState(connection, VoiceConnectionStatus.Ready, 20_000);

  const player = createAudioPlayer();
  connection.subscribe(player);

  const session = { connection, player, textChannel, listening: new Set(), queue: Promise.resolve(), speaking: false };
  sessions.set(channel.guild.id, session);

  connection.receiver.speaking.on("start", (userId) => {
    if (session.listening.has(userId) || session.speaking) return;
    session.listening.add(userId);
    captureUtterance(connection, userId)
      .then((pcm) => {
        session.listening.delete(userId);
        if (pcm.length < MIN_AUDIO_BYTES) return;
        // Handle one utterance at a time so replies don't talk over each other.
        session.queue = session.queue.then(() => handleUtterance(session, userId, pcm, onSpeech)).catch((err) => {
          console.error("Voice error:", err);
        });
      })
      .catch((err) => {
        session.listening.delete(userId);
        console.error("Listening error:", err);
      });
  });

  connection.on(VoiceConnectionStatus.Disconnected, async () => {
    try {
      await Promise.race([
        entersState(connection, VoiceConnectionStatus.Signalling, 5_000),
        entersState(connection, VoiceConnectionStatus.Connecting, 5_000),
      ]);
    } catch {
      leaveVoice(channel.guild.id);
    }
  });

  return channel;
}

export function leaveVoice(guildId) {
  sessions.delete(guildId);
  const connection = getVoiceConnection(guildId);
  if (connection) {
    connection.destroy();
    return true;
  }
  return false;
}

function captureUtterance(connection, userId) {
  return new Promise((resolve, reject) => {
    const opusStream = connection.receiver.subscribe(userId, {
      end: { behavior: EndBehaviorType.AfterSilence, duration: SILENCE_MS },
    });
    const decoder = new prism.opus.Decoder({ rate: 48000, channels: 2, frameSize: 960 });
    const chunks = [];
    opusStream.pipe(decoder);
    decoder.on("data", (chunk) => chunks.push(chunk));
    decoder.on("end", () => resolve(Buffer.concat(chunks)));
    decoder.on("error", reject);
    opusStream.on("error", reject);
  });
}

async function handleUtterance(session, userId, pcm, onSpeech) {
  const transcript = await speechToText(pcm);
  if (!transcript) return;

  // Each sentence is turned into speech as soon as it's written, and played in order,
  // so the friend starts talking before the whole reply is finished.
  let chain = Promise.resolve();
  let saidSomething = false;
  const say = (sentence, voice) => {
    saidSomething = true;
    session.speaking = true;
    const audio = textToSpeech(sentence, voice);
    audio.catch(() => {});
    chain = chain.then(async () => playAudio(session, await audio)).catch((err) => console.error("Voice error:", err));
    return chain;
  };

  try {
    const result = await onSpeech(userId, transcript, say);
    if (!saidSomething && result?.reply) say(result.reply, result.voice);
    await chain;
  } finally {
    session.speaking = false;
  }
}

// Say something out loud in the voice channel (e.g. a hello when joining).
export async function sayInVoice(guildId, text, voice) {
  const session = sessions.get(guildId);
  if (!session) return;
  session.queue = session.queue.then(() => playText(session, text, voice)).catch((err) => {
    console.error("Voice error:", err);
  });
  return session.queue;
}

async function playText(session, text, voice) {
  const audio = await textToSpeech(text, voice);
  session.speaking = true;
  try {
    await playAudio(session, audio);
  } finally {
    session.speaking = false;
  }
}

async function playAudio(session, audio) {
  session.player.play(createAudioResource(Readable.from([audio]), { inputType: StreamType.Raw }));
  await entersState(session.player, AudioPlayerStatus.Playing, 5_000);
  await entersState(session.player, AudioPlayerStatus.Idle, 120_000);
}
