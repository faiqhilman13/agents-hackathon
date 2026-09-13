# ✦ Cortex (万能书)

**Your library reads with you.**

Cortex is a Chrome extension that brings the sharpest related sources on the web into the margin of whatever you're reading. There's no upload, no search bar, and no new app to open. Built for the **Agents, Everywhere** global hackathon, 13 September 2026.

As you read any page, Cortex quietly pulls out the article text, searches the whole web *by meaning*, and shows you the **3 sharpest related sources** in a sidebar:

- 📚 **The canonical source**: the original research, the official doc, the foundational piece.
- ⚔️ **The strongest opposing view**: the best argument against what you're reading.
- 🔀 **One unexpected connection**: a different field, era, or angle that reframes it.

Each card has a one-line **"why this matters"** and a highlighted quote from the source.

---

## Why this exists

Knowledge workers read hundreds of things a month and retain a small fraction. Tools like NotebookLM and Perplexity are reactive: you have to know what to ask, and you have to go to a separate tab to ask it. Cortex flips this. While you read, an agent finds the original source, the sharpest counter-argument, and one unexpected connection, and puts them in a sidebar in the tab you're already in.

The environment is essential to the value. This couldn't exist in a chatbox.

---

## How it works

```
 ┌──────────────────── Chrome tab ────────────────────┐
 │  content.js                                        │
 │   1. extract <article>/<main>/body innerText       │        ┌──────── backend/ (Vercel) ───────┐
 │   2. inject .cortex- sidebar (top-right)           │        │  POST /api/related               │
 │   5. render 3 cards  ◄──────────────┐              │        │   3a. Exa searchAndContents      │
 └──────────────┬──────────────────────┼──────────────┘        │       8 neural results +         │
                │ chrome.runtime        │                       │       2-sentence highlights      │
                │ .sendMessage          │                       │   3b. OpenRouter gpt-4o-mini     │
 ┌──────────────▼──────────────────────┴──────────────┐        │       picks best 3 (JSON) +      │
 │  background.js (service worker)                    │ fetch  │       writes "whyItMatters"      │
 │   FETCH_RELATED → POST {url,title,text}  ──────────┼───────►│   4. { suggestions: [...] }      │
 │   ◄──────────── { suggestions: [x3] }  ◄───────────┼────────│                                  │
 └────────────────────────────────────────────────────┘        └──────────────────────────────────┘
```

**CORS is handled twice.** The backend sends `Access-Control-Allow-Origin: *` on every response. On top of that, the extension never fetches from the page itself: all requests go through the background service worker, so the host page's origin and CSP are never involved.

**No hallucinated links.** The LLM only returns *candidate numbers* plus a sentence. Titles, URLs, and quotes always come straight from Exa. If the LLM call fails, Cortex falls back to Exa's own top 3.

---

## Repo structure

```
agents-hackathon/
├── README.md                ← you are here
├── .gitignore
├── backend/                 ← Vercel serverless API (Node 20+, ES modules)
│   ├── api/
│   │   ├── related.js       ← POST /api/related  (the main pipeline)
│   │   └── health.js        ← GET  /api/health   → { ok: true }
│   ├── lib/
│   │   ├── exa.js           ← Exa neural search
│   │   ├── rank.js          ← OpenRouter LLM ranking prompt + JSON parsing
│   │   └── http.js          ← CORS + JSON helpers
│   ├── dev-server.js        ← zero-config local server (npm run dev)
│   ├── test-related.sh      ← curl smoke test
│   ├── package.json
│   ├── vercel.json          ← 30s function timeout
│   ├── .env.example
│   └── README.md            ← keys, deploy, common errors
├── extension/               ← Chrome MV3 extension, vanilla JS, no build step
│   ├── manifest.json
│   ├── config.js            ← BACKEND_URL, MIN_ARTICLE_CHARS, DEBUG
│   ├── content.js           ← extraction + sidebar UI
│   ├── background.js        ← backend fetch + toolbar toggle
│   ├── sidebar.css
│   ├── icons/               ← icon16/48/128.png + generate_icons.py
│   └── README.md            ← how to load it in Chrome
└── demo/
    └── demo-articles.md     ← pre-tested articles + 60-second demo flow
```

---

## Quick start (about 5 minutes)

**Prerequisites:** Node.js 20.6+, Google Chrome, an [Exa API key](https://dashboard.exa.ai/api-keys), and an [OpenRouter API key](https://openrouter.ai/keys). [backend/README.md](backend/README.md) covers getting keys.

### 1. Run the backend

```bash
cd backend
cp .env.example .env        # then paste your EXA_API_KEY and OPENROUTER_API_KEY into .env
npm install
npm run dev                 # → http://localhost:3000
```

Check it's alive: open <http://localhost:3000/api/health> and you should see `{"ok":true}`. Then run the full pipeline once:

```bash
./test-related.sh           # health + CORS preflight + a real /api/related call
```

> `npm run dev` runs a tiny Node server around the exact same handlers Vercel uses, so you don't need a Vercel login. Prefer Vercel's emulator? Use `npm run dev:vercel`.

### 2. Load the extension

1. Go to `chrome://extensions` and turn on **Developer mode**.
2. Click **Load unpacked** and select the `extension/` folder.
3. Pin the purple ✦ Cortex icon.

### 3. Read something

Open a long article, such as one from [demo/demo-articles.md](demo/demo-articles.md). The Cortex panel slides in top-right, shows a spinner, and then 3 cards. Click the toolbar icon to toggle it.

More detail and troubleshooting: [extension/README.md](extension/README.md).

---

## Deploy the backend to Vercel

```bash
cd backend
npx vercel                              # first run: log in + link the project (accept defaults)
npx vercel env add EXA_API_KEY          # paste key, select Production (+ Preview/Development if you like)
npx vercel env add OPENROUTER_API_KEY
npx vercel --prod                       # → https://<your-project>.vercel.app
./test-related.sh https://<your-project>.vercel.app
```

Then set `BACKEND_URL` in `extension/config.js` to that URL and reload the extension on `chrome://extensions`.

---

## Where to tweak things

| Want to… | Edit |
| --- | --- |
| Change Cortex's "taste" (what counts as sharp) | `SYSTEM_PROMPT` in `backend/lib/rank.js` |
| Swap the LLM | `MODEL` in `backend/lib/rank.js` (any [OpenRouter model id](https://openrouter.ai/models)) |
| Get more or fewer candidates, or longer highlights | `NUM_RESULTS` and `highlights` in `backend/lib/exa.js` |
| Change which pages trigger Cortex | `MIN_ARTICLE_CHARS` in `extension/config.js` |
| Restyle the sidebar | `extension/sidebar.css` (colors are listed at the top) |
| Change the icon | Edit and re-run `python extension/icons/generate_icons.py` |

---

## What each teammate does

| Role | Person | Owns | Files |
|------|--------|------|-------|
| Product lead | chchia | Demo path, video, submit | `demo/`, `README.md` |
| Agent / backend | chchia (temp) | `/related` endpoint, deploy | `backend/` |
| Extension / UI | EY teammate | manifest, content script, sidebar styling | `extension/` |
| Frontend polish | coder teammate | improve card UI, add states | `extension/sidebar.css`, `extension/content.js` |
| Content / QA | law teammate | demo articles, README, adversarial testing | `demo/` |

The `backend/` and `extension/` folders are independent, so there are no merge conflicts as long as each owner stays in their own folder.

---

## Judging targets

### Innovation & Theme Alignment (target 5/5)
- **The environment is the interface.** Cortex is an agent that runs *inside the browser tab*, reacting to what you're reading. There's no chatbox, no prompt, and no context switching.
- **An opinionated agent, not a search box.** It doesn't return "10 blue links". It decides which 3 sources matter and why, using a deliberate editorial mix: canonical, opposing, unexpected.
- **Built to show critical thinking.** It always surfaces the strongest counter-view next to what you're reading.

### Best Use of Exa
- Uses **neural search** (`searchAndContents`, `type: "neural"`) with the article itself as the query: meaning-based retrieval rather than keyword matching.
- **Highlights** (2 sentences per result) serve double duty. They ground the LLM's ranking in real source text, and they appear to the user as evidence quotes on each card.
- **Exa is the source of truth.** Every title, URL, and quote comes from Exa. The LLM only chooses among the results and explains its picks. Call this out in the demo video and the social post.

### Best Use of CopilotKit
> ⚠️ **Status: not yet integrated.** The current build uses the OpenAI SDK against OpenRouter directly.
> Ways to add it, if time permits:
> - Swap the vanilla sidebar for a CopilotKit `<CopilotSidebar>`. This needs React and a bundler, so it would be a separate build of `extension/`.
> - Keep the vanilla extension and host the ranking step as a CopilotKit runtime agent (`@copilotkit/runtime`) in the backend, with `/api/related` calling it.
> - Add an "Ask about this source" follow-up that goes through a CopilotKit endpoint, grounded in the page and the 3 cards.

---

## Ideas for next steps
- **Personalization ("you read this 3 weeks ago")**: see Layer 2 in [backend/README.md](backend/README.md).
- Re-run automatically on single-page-app navigation (watch for `location.href` changes).
- Label each card with its role (canonical / opposing / unexpected). `rank.js` already asks the LLM for it.
- Cache results server-side (for example with Vercel KV) so popular articles are instant.
- Dark-mode styles via `prefers-color-scheme`.

---

## License

MIT
