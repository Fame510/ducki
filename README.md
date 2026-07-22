# DUCKi 🦆 — by AEON DUX

**Your own AI agent, and a private live video house — running on your keys, your device, nobody's servers.**

DUCKi is a fully client-side web app hosted on GitHub Pages. There is no backend to trust: your API keys, chats, and video streams stay on your device. Bring your own LLM key, connect the tools you want, and go.

🔗 **Live:** https://fame510.github.io/ducki/

---

## What's inside

### 🧠 DUCKi Console (`app.html`)
A full autonomous agent that runs its own plan → tool → verify loop in your browser. Pick a brain, ask, and it *does the work* — chaining many tool calls before it answers, then reporting the real links and results.

**Brains** — no key, or your own key:
- **On-device Genius** (Llama-3.2-1B, WebGPU) and **On-device Light** (Qwen2.5-0.5B) — run fully on your device, **no key, fully private**
- Any cloud LLM with your key: **OpenAI, Anthropic (Claude), Gemini, DeepSeek, GLM, Qwen, Kimi, OpenRouter, SiliconFlow**

**Tools** — a compounding toolkit:
- **Web, no key needed** — `web_search`, `read_url` (read any page as clean text), `generate_image` (text-to-image, shown inline)
- **Web, premium (free Firecrawl key)** — scrape, structured extraction, and human-like **browser automation** (click / type / scroll / submit forms)
- **Code & data** — `run_js` executes JavaScript in-browser for math, parsing, algorithms, and tables
- **GitHub** — read repos (incl. private), search, create repos/issues, **commit & push code**, create gists
- **Gmail** — read and summarize your mail
- **Universal connector** — `http_request` calls **any REST API** (Notion, Airtable, Linear, Stripe, weather, news, CRMs — thousands of services)
- **Memory** — remembers durable facts about you across sessions, on-device

**Connections vault** — store an API key for any service once; DUCKi references it as `{{vault:NAME}}` and the secret is injected on your device — **never sent to the model**. Ask *"what can you do?"* and DUCKi enumerates its full, current ability list.

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
