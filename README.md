# AI Game Friend

A customizable AI friend that hangs out on Discord and plays co-op games like Minecraft with you.

**Status: steps 1 and 2 of 4.** Your friend chats in Discord text and voice, every tester can customize their own friend, and it remembers the key things you tell it across days. It can also join you in Minecraft (Java edition) as a real player.

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
| `!friend mc join <address>` | Joins a Minecraft server, e.g. `!friend mc join play.example.com` |
| `!friend mc join <port>` | Joins your single player world after you click Open to LAN |
| `!friend mc leave` / `!friend mc status` | Leaves Minecraft, or shows what it's doing |
| `!friend mc logout` | Forgets the friend's Minecraft sign-in so you can sign in again |
| `!friend set minecraftName Steve` | Tells your friend which Minecraft player is you |
| `!friend join` | Joins the voice channel you're in, listens, and talks back |
| `!friend leave` | Leaves the voice channel |
| `!friend set greeting Hey hey, Pixel's here!` | What it says out loud when it joins voice. Without this, it makes up a fresh hello each time |
| `!friend voices` | Lists all the voices you can pick |
| `!friend set voice luna` | Changes the voice it speaks with |

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

## Playing Minecraft together

Your friend joins as a real player on **Minecraft Java edition**. It can:

- **Follow you** around, or **come to you**
- **Gather blocks**: wood, stone, ores, dirt, sand, and more
- **Guard you** by fighting zombies, skeletons, spiders, and creepers near you (it never attacks players)
- **Chat**: talk to it in Minecraft chat, here in Discord, or in voice. Saying "follow me" in voice works while you play.

Its **gamer skill** setting (`!friend set gamerSkill 1` to `10`) changes how it plays. Low skill reacts slowly, doesn't sprint or parkour, and gathers less per trip. High skill reacts fast, sprints, spots mobs from further away, and fights better.

### One-time setup

1. **Make a Minecraft account for your friend.** It needs its own Microsoft account with Minecraft Java, just like a second player.
2. Add these lines to your `.env` file:
   ```
   MC_USERNAME=the-friends-account-email@example.com
   MC_AUTH=microsoft
   ```
3. Restart the friend (Ctrl + C, then `npm start`).
4. In Discord, type `!friend set minecraftName YourMinecraftName` so it knows which player is you.
5. The first time it joins, it posts a link and a code in Discord. Open the link, sign in with **the friend's** Microsoft account, and enter the code. It remembers the login after that.

### Joining your single player world

1. Open your world, press Esc, click **Open to LAN**, then **Start LAN World**.
2. Minecraft shows a message like "Local game hosted on port **54321**".
3. In Discord, type `!friend mc join 54321` (use your number). The friend must be running on the same PC, or on the same home network.

### Joining a hosted server

Type `!friend mc join the.server.address` (add `:port` if the server uses one). If the server has a whitelist, add the friend's Minecraft name to it first.

### Minecraft version

The friend can play Minecraft Java up to the newest version its bot toolkit supports (26.1.2 right now). New Minecraft versions usually get support a few weeks to months after release. If your game is newer, the friend says so when it tries to join.

- **Single player:** open the Minecraft Launcher, go to **Installations** → **New installation**, pick version **release 26.1.2**, and play that installation. Use a **new world or a copy** of your world. Opening a world in an older version than it was last played in can break it.
- **Hosted servers:** ask the owner to install the **ViaVersion** plugin. It lets players on older versions join, including the friend.

When a newer toolkit is released, download the latest code and run `npm update` to get it.

### Modpacks

The friend speaks plain Minecraft. Vanilla servers, and Fabric/Paper/Spigot servers with server-side plugins or mods, work. Modpacks that need every player to install the same mods (most Forge and NeoForge packs, big Fabric packs) won't let the friend join.

## How memory works

- After about 6 messages from you, or 5 quiet minutes, the friend asks Claude to pick out the key points and saves them.
- Memories are saved on the computer running the friend, in the `data/memories` folder, one file per person. They are never uploaded to GitHub.
- When you stop the friend with Ctrl + C, it saves any unsaved memories first. Wait for it to finish before closing the window.
- Testers can type `!friend memories` to see what it knows and `!friend forgetme` to erase it. Tell your testers about this. It's good practice to let people know what's saved about them.

## Using voice chat

1. Join a voice channel in your server.
2. In any text channel, type `!friend join`. The friend joins your voice channel and says hello.
3. Talk normally. When you pause, it answers out loud and starts speaking as soon as its first sentence is ready.
4. Type `!friend leave` when you're done.

Tips: use headphones so the friend doesn't hear itself, and talk one at a time. It answers each person with that person's own custom friend settings.

### Voices

Type `!friend voices` in Discord to see all 40+ voices, then pick one with its short name, e.g. `!friend set voice luna` or `!friend set voice orion`.

- **Feminine:** thalia (default), luna, asteria, athena, aurora, andromeda, amalthea, callista, cora, cordelia, delia, electra, harmonia, helena, hera, iris, juno, minerva, ophelia, pandora, phoebe, selene, theia, vesta
- **Masculine:** orion, apollo, arcas, aries, atlas, draco, hermes, hyperion, janus, jupiter, mars, neptune, odysseus, orpheus, pluto, saturn, zeus

If a name doesn't work, the friend uses the default voice instead, and the black window shows which name failed.

## Optional settings (in `.env`)

- `CLAUDE_MODEL`: which Claude model it uses. The default is `claude-opus-5-5`. `claude-sonnet-5-5` and `claude-haiku-5-5` cost less.
- `FRIEND_CHANNEL_IDS`: channels where it answers every message without an @mention. To get a channel ID, turn on Developer Mode in Discord (User Settings > Advanced), then right-click the channel and choose **Copy Channel ID**.
- `HISTORY_LENGTH`: how many recent messages it keeps in mind during a chat.
- `MEMORY_SAVE_EVERY`: how many messages from a person before it saves memories (default 6).
- `MEMORY_MAX_FACTS`: the most things it remembers about one person (default 40).
- `VOICE_SILENCE_MS`: how long a pause (in milliseconds) means you've finished talking. The default is 700. Raise it to 1000 if it cuts you off, or lower it to 500 for snappier replies.
- `VOICE_TRANSCRIPTS`: set to `on` to also post what it heard and said in voice as text. This helps with troubleshooting. It's off by default.
- `VOICE_MODEL`: use a different Claude model just for voice. `claude-haiku-5-5` answers fastest and costs the least, while text chat keeps the main model.

## Troubleshooting

- **"Missing DISCORD_TOKEN or ANTHROPIC_API_KEY"**: the `.env` file is missing or misnamed. It must be exactly `.env`, not `.env.txt`.
- **"Used disallowed intents"**: turn on Message Content Intent (step 3.5).
- **Online but never answers**: make sure you @mention it, and that it can see and send messages in that channel.
- **"Voice chat needs a DEEPGRAM_API_KEY"**: add your Deepgram key to `.env` (step 4b), then restart with Ctrl + C and `npm start`.
- **"I couldn't join the voice channel"**: re-invite the bot with the Connect and Speak permissions (step 3.6).
- **Joins voice but never answers**: check the black window for errors. Make sure your Discord microphone works and that you aren't muted. Try talking a bit longer, at least a full sentence.
- **"Couldn't join Minecraft"**: check the address and port, make sure the world is still open to LAN, and check that the server version is Java edition. If it says the version isn't supported, set `MC_VERSION` in `.env` to the server's version, like `1.21.4`.
- **"doesn't have a Minecraft Java profile" / "does the account own minecraft?"**: the friend signed in with the wrong account, or its account has no profile name yet. Check at minecraft.net (signed in as the friend's account) that it owns Java and has a profile name. Then type `!friend mc logout` and `!friend mc join` again, and sign in with the friend's account when the code appears. Use a private browser window so your own login doesn't get used by accident.
- **Friend can't find you in Minecraft**: set `!friend set minecraftName` to your exact Minecraft name, and stand within about 30 blocks of it.
- **It says "my brain glitched"**: look at the Terminal window for the error. Usually the Claude key is wrong or out of credit.

## Roadmap

1. **Discord companion core** with voice chat (this version)
2. **Memory** of the key things you tell it, across days (this version)
3. **Minecraft**: joins your server as a player, with a gamer skill setting (this version)
4. **5-person trial**: feedback form and results summary
