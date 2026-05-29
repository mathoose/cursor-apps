# Voice Notes

Speak notes on your phone — transcribed and organized locally. Nothing leaves your device.

## Features

- **Voice transcription** — tap the mic, speak, see live text (uses your phone’s speech engine)
- **Auto-organize** — sorts into Work, 3D Print, Dog, Home, Shopping, Ideas, Personal
- **Action items** — picks up phrases like “need to…”, “remember to…”, “todo…”
- **Search & filters** — find notes by keyword or category
- **Star important notes** — pinned to the top
- **Private** — all notes stored in browser `localStorage` on your phone only

## Live site

- **Production:** https://voice-notes-emily.netlify.app

## iPhone setup

Open the **HTTPS** URL in Safari (HTTPS required for microphone):

1. Open your **HTTPS** URL
2. Allow microphone when prompted
3. **Share → Add to Home Screen** — uses the voice-note mic icon

## Local testing

Open `index.html` in a browser. Microphone and speech recognition require **HTTPS** on iPhone — use the deployed site for real voice tests.

## Deploy

From the project root:

```bash
npx netlify deploy --prod --dir=voice-notes
```

Or drag the `voice-notes` folder into [Netlify Drop](https://app.netlify.com/drop).

## Privacy

- Notes: browser `localStorage` on your device
- Speech: processed by iOS/Android/Chrome — not sent to Netlify
- No account, no cloud sync

## Tips

- Speak in full sentences for better transcription
- Say “need to buy filament” or “vet appointment for the dog” — categories detect keywords automatically
- You can edit any note after saving (title, category, body)
- **Send to Cursor** — copies a formatted note and opens [cursor.com/agents](https://cursor.com/agents); paste to kick off an agent
- Toggle **By date** / **By category** to browse your notes
