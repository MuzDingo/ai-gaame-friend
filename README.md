# AI Game Friend

A customizable AI friend that hangs out on Discord and plays co-op games like Minecraft with you.

**Status: steps 1 and 2 of 4.** Your friend chats in Discord text and voice, every tester can customize their own friend, and it remembers the key things you tell it across days. Minecraft play comes next.

## What it can do right now

- Chat naturally when you @mention it, send it a direct message, or talk in a channel you pick.
- Each person gets their own friend: name, personality, character, kindness, humor, talkativeness, gamer skill, favorite games and extra notes.
- Talks out loud in voice channels: type `!friend join` while you're in a voice channel, then just talk.
- Remembers the last 20 or so messages in a channel during a chat.
- **Long-term memory:** every few messages it saves key points about you, like your favorite games, your projects, your pets and your inside jokes. It brings them up naturally in later chats, even after a restart.

## Customizing your friend (in Discord)

| Type this | What it does |
|---|---|
| `!friend help` | Lists every setting |
| `!friend show` | Shows your friend's current settings |
| `!friend set name Nova` | Renames your friend |
| `!friend set kindness 9` | Number settings go from 1 to 10 |
| `!friend set personality calm, witty, loves dragons` | Describe them in your own words |
| `!friend set favoriteGames Minecraft, ARK, ASKA` | Comma separated list |
| `!friend reset` | Back to the default friend |
| `!friend forget` | Clears the recent chat in that channel |
| `!friend memories` | Shows what your friend remembers about you |
| `!friend forgetme` | Erases everything your friend remembers about you |
| `!friend join` | Joins the voice channel you're in, listens, and talks back |
| `!friend leave` | Leaves the voice channel |
| `!friend set greeting Hey hey, Pixel's here!` | What it says out loud when it joins voice. Without this, it makes up a fresh hello each time |
| `!friend set voice aura-2-orion-en` | Changes the voice it speaks with (see Voices below) |

The default friend, "Pixel", lives in `profiles/default.json`. You can edit that file to change who everyone starts with.

---

# Setup guide (no coding needed)

This takes about 20 to 30 minutes the first time. You do it once.

## 1. Install Node.js

1. Go to https://nodejs.org and download the **LTS** version.
2. Run the installer and click Next through everything.
3. To check it worked, open **Terminal** (Mac) or **Command Prompt** (Windows), type `node -v`, and press Enter. You should see a number like `v22.x.x`.

## 2. Download this project

1. On this repository's GitHub page, click the green **Code** button, then **Download ZIP**.
2. Unzip it somewhere easy, like your Desktop.

## 3. Create the Discord bot

1. Go to https://discord.com/developers/applications and sign in.
2. Click **New Application**, name it (for example "Pixel"), and click Create.
3. In the left menu click **Bot**.
4. Click **Reset Token**, then **Copy**. This is your `DISCORD_TOKEN`. Treat it like a password.
5. On the same page, scroll to **Privileged Gateway Intents** and turn on **Message Content Intent**. Click **Save Changes**.
6. In the left menu click **OAuth2**, then **URL Generator**.
   - Under Scopes, tick **bot**.
   - Under Bot Permissions, tick **View Channels**, **Send Messages**, **Read Message History**, **Connect** and **Speak**.
   - Already added the bot before voice chat existed? Just open the new link and authorize again to give it the voice permissions.
7. Copy the URL at the bottom, open it in your browser, pick your Discord server, and click Authorize. Your bot now shows up (offline) in your server.

## 4. Get a Claude API key

1. Go to https://console.anthropic.com and sign up or sign in.
2. Under **Billing**, add a payment method and a small amount of credit. You only pay for what the friend says. Setting a monthly spending limit there is a good idea for the trial.
3. Go to **API Keys**, click **Create Key**, and copy it. This is your `ANTHROPIC_API_KEY`.

## 4b. Get a Deepgram key (for voice chat)

Claude reads and writes text, so voice chat uses Deepgram to hear you and to speak. Skip this step if you only want text chat.

1. Go to https://console.deepgram.com and sign up. New accounts get free starter credit.
2. Open **API Keys** and click **Create a New API Key**. Give it any name and copy it. This is your `DEEPGRAM_API_KEY`.

## 5. Add your keys

1. In the project folder, find `.env.example`. Make a copy and name the copy exactly `.env`.
   - Windows: if it won't let you, open Notepad, paste the contents in, and save with "Save as type: All files" and the name `.env`.
   - Mac: files starting with a dot are hidden. Press Cmd + Shift + . in Finder to show them.
2. Open `.env` in a text editor, replace the placeholder values with your Discord token and Claude key, and save. For voice chat, also paste your Deepgram key after `DEEPGRAM_API_KEY=`.
   - Already have a `.env` from before? Just add a new line at the bottom: `DEEPGRAM_API_KEY=yourkey`.

Never share your `.env` file or post the keys anywhere. GitHub is already set up to ignore it.

## 6. Start your friend

1. Open Terminal or Command Prompt in the project folder.
   - Windows: open the folder, click the address bar, type `cmd`, and press Enter.
   - Mac: right-click the folder in Finder and choose **New Terminal at Folder**.
2. The first time only, type `npm install` and press Enter. Wait for it to finish.
3. Type `npm start` and press Enter.
4. When you see **"Your AI friend is online"**, go to Discord and type `@Pixel hey!` in a channel.

To stop the friend, click the Terminal window and press Ctrl + C. It's only online while that window is open. Later we can move it to a cheap always-on server.

## How memory works

- After about 6 messages from you, or 5 quiet minutes, the friend asks Claude to pick out the key points and saves them.
- Memories are saved on the computer running the friend, in the `data/memories` folder, one file per person. They are never uploaded to GitHub.
- When you stop the friend with Ctrl + C, it saves any unsaved memories first. Wait for it to finish before closing the window.
- Testers can type `!friend memories` to see what it knows and `!friend forgetme` to erase it. Tell your testers about this. It's good practice to let people know what's saved about them.

## Using voice chat

1. Join a voice channel in your server.
2. In any text channel, type `!friend join`. The friend joins your voice channel and says hello.
3. Talk normally. When you pause for about a second, it answers out loud. It also posts what it heard and what it said in the text channel, which helps you spot problems.
4. Type `!friend leave` when you're done.

Tips: use headphones so the friend doesn't hear itself, and talk one at a time. It answers each person with that person's own custom friend settings.

### Voices

Change the voice with `!friend set voice <name>`. A few to try:

| Name | Sounds like |
|---|---|
| `aura-2-thalia-en` | Clear, friendly female voice (default) |
| `aura-2-luna-en` | Soft, calm female voice |
| `aura-2-orion-en` | Relaxed male voice |
| `aura-2-apollo-en` | Confident, casual male voice |

Deepgram lists all of its voices on its text-to-speech models page in the Deepgram docs. Any name starting with `aura-` works. If a name is wrong, the friend falls back to the default voice.

## Optional settings (in `.env`)

- `CLAUDE_MODEL`: which Claude model it uses. The default is `claude-opus-5-5`. `claude-sonnet-5-5` and `claude-haiku-5-5` cost less.
- `FRIEND_CHANNEL_IDS`: channels where it answers every message without an @mention. To get a channel ID, turn on Developer Mode in Discord (User Settings > Advanced), then right-click the channel and choose **Copy Channel ID**.
- `HISTORY_LENGTH`: how many recent messages it keeps in mind during a chat.
- `MEMORY_SAVE_EVERY`: how many messages from a person before it saves memories (default 6).
- `MEMORY_MAX_FACTS`: the most things it remembers about one person (default 40).
- `VOICE_SILENCE_MS`: how long a pause (in milliseconds) means you've finished talking. Raise it to 1200 if it cuts you off. Lower it to 700 if it feels slow.

## Troubleshooting

- **"Missing DISCORD_TOKEN or ANTHROPIC_API_KEY"**: the `.env` file is missing or misnamed. It must be exactly `.env`, not `.env.txt`.
- **"Used disallowed intents"**: turn on Message Content Intent (step 3.5).
- **Online but never answers**: make sure you @mention it, and that it can see and send messages in that channel.
- **"Voice chat needs a DEEPGRAM_API_KEY"**: add your Deepgram key to `.env` (step 4b), then restart with Ctrl + C and `npm start`.
- **"I couldn't join the voice channel"**: re-invite the bot with the Connect and Speak permissions (step 3.6).
- **Joins voice but never answers**: check the black window for errors. Make sure your Discord microphone works and that you aren't muted. Try talking a bit longer, at least a full sentence.
- **It says "my brain glitched"**: look at the Terminal window for the error. Usually the Claude key is wrong or out of credit.

## Roadmap

1. **Discord companion core** with voice chat (this version)
2. **Memory** of the key things you tell it, across days (this version)
3. **Minecraft**: joins your server as a player, with a gamer skill setting
4. **5-person trial**: feedback form and results summary
