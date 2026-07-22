# DUCKi 🦆 — by AEON DUX

**Your own AI agent, and a private live video house — running on your keys, your device, nobody's servers.**

DUCKi is a fully client-side web app hosted on GitHub Pages. There is no backend to trust: your API keys, chats, and video streams stay on your device. Bring your own LLM key, connect the tools you want, and go.

🔗 **Live:** https://fame510.github.io/ducki/

---

## What's inside

### 🧠 DUCKi Console (`app.html`)
A bring-your-own-key AI workspace. Add your own LLM key (OpenAI-compatible), and optionally connect:
- **GitHub** — read/manage repos with a personal access token
- **Gmail** — via your own Google OAuth client
- **Firecrawl** — web scraping/search with your key

Everything is stored locally in your browser. No server ever sees your keys.

### 🎙️ Speak to Ducky (`index.html`)
A hands-free voice assistant that runs **100% in your browser** — no cloud, no API key:
- **On-device speech recognition** via **Whisper** (transformers.js, WebGPU/WASM) — works on Android Chrome and desktop
- Optional **"Hey DUCKi" wake word**
- **On-device LLM** (Qwen2.5-0.5B) for real reasoning, or an instant fast-reply mode
- **Voice replies** (browser speech synthesis) and **local memory** (IndexedDB)

Tap the orb, talk, pause — DUCKi transcribes on your device and answers.

### 📹 The Duck House (`room.html` + `rooms.js`)
Instant, private, peer-to-peer live video rooms (WebRTC via PeerJS):
- Up to **6 people** per room, direct device-to-device — streams never touch a server
- **Anonymous nicknames** — no accounts, no real names required
- **Host controls** — the room creator approves who joins and can remove anyone
- **One-tap invite** — share a link (`?room=CODE`); friends tap it and land straight in the room

---

## Run it yourself

It's a static site — clone and open, or host on any static host:

```bash
git clone https://github.com/Fame510/ducki.git
cd ducki
# serve locally (any static server works)
python3 -m http.server 8080
# then open http://localhost:8080
```

> A microphone and camera require a secure context (HTTPS or `localhost`). The live GitHub Pages URL is already HTTPS.

## Desktop app (optional)
Linux builds (AppImage / Snap) are published on the [Releases](https://github.com/Fame510/ducki/releases) page. macOS & Windows builds are produced via the repo's GitHub Actions release workflow.

---

## Privacy model
- **Your keys, your machine, nobody's servers.** LLM keys and tool tokens live only in your browser's local storage.
- **Voice & AI** run on-device (Whisper + a local model) — no audio or text is sent to a server.
- **Video** is peer-to-peer end-to-end; a signaling/relay server is used only to help peers find each other, not to see your media.

## Tech
Vanilla HTML/CSS/JS · [transformers.js](https://github.com/huggingface/transformers.js) (Whisper + Qwen) · [PeerJS](https://peerjs.com/) (WebRTC) · hosted on GitHub Pages.

## License
MIT © AEON DUX
