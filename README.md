# AI Game Friend

A customizable AI friend that hangs out on Discord and plays co-op games like Minecraft with you.

**Status: step 1 of 4.** Your friend can chat in Discord text channels and direct messages, and every tester can customize their own friend. Voice chat, long-term memory and Minecraft play come next.

## What it can do right now

- Chat naturally when you @mention it, send it a direct message, or talk in a channel you pick.
- Each person gets their own friend: name, personality, character, kindness, humor, talkativeness, gamer skill, favorite games and extra notes.
- Remembers the last 20 or so messages in a channel during a chat. (It forgets on restart; real memory is step 2.)

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
   - Under Bot Permissions, tick **View Channels**, **Send Messages** and **Read Message History**.
7. Copy the URL at the bottom, open it in your browser, pick your Discord server, and click Authorize. Your bot now shows up (offline) in your server.

## 4. Get a Claude API key

1. Go to https://console.anthropic.com and sign up or sign in.
2. Under **Billing**, add a payment method and a small amount of credit. You only pay for what the friend says. Setting a monthly spending limit there is a good idea for the trial.
3. Go to **API Keys**, click **Create Key**, and copy it. This is your `ANTHROPIC_API_KEY`.

## 5. Add your keys

1. In the project folder, find `.env.example`. Make a copy and name the copy exactly `.env`.
   - Windows: if it won't let you, open Notepad, paste the contents in, and save with "Save as type: All files" and the name `.env`.
   - Mac: files starting with a dot are hidden. Press Cmd + Shift + . in Finder to show them.
2. Open `.env` in a text editor, replace the two placeholder values with your Discord token and Claude key, and save.

Never share your `.env` file or post the keys anywhere. GitHub is already set up to ignore it.

## 6. Start your friend

1. Open Terminal or Command Prompt in the project folder.
   - Windows: open the folder, click the address bar, type `cmd`, and press Enter.
   - Mac: right-click the folder in Finder and choose **New Terminal at Folder**.
2. The first time only, type `npm install` and press Enter. Wait for it to finish.
3. Type `npm start` and press Enter.
4. When you see **"Your AI friend is online"**, go to Discord and type `@Pixel hey!` in a channel.

To stop the friend, click the Terminal window and press Ctrl + C. It's only online while that window is open. Later we can move it to a cheap always-on server.

## Optional settings (in `.env`)

- `CLAUDE_MODEL`: which Claude model it uses. The default is `claude-opus-5-5`. `claude-sonnet-5-5` and `claude-haiku-5-5` cost less.
- `FRIEND_CHANNEL_IDS`: channels where it answers every message without an @mention. To get a channel ID, turn on Developer Mode in Discord (User Settings > Advanced), then right-click the channel and choose **Copy Channel ID**.
- `HISTORY_LENGTH`: how many recent messages it keeps in mind during a chat.

## Troubleshooting

- **"Missing DISCORD_TOKEN or ANTHROPIC_API_KEY"**: the `.env` file is missing or misnamed. It must be exactly `.env`, not `.env.txt`.
- **"Used disallowed intents"**: turn on Message Content Intent (step 3.5).
- **Online but never answers**: make sure you @mention it, and that it can see and send messages in that channel.
- **It says "my brain glitched"**: look at the Terminal window for the error. Usually the Claude key is wrong or out of credit.

## Roadmap

1. **Discord companion core** (this version), then voice chat
2. **Memory** of the key things you tell it, across days
3. **Minecraft**: joins your server as a player, with a gamer skill setting
4. **5-person trial**: feedback form and results summary
