# Margin Research

Margin is a local-first Chrome research companion for articles, arXiv papers, selected passages, and content already loaded on social pages. The extension captures the page you choose; a local server creates a source-linked brief and keeps a searchable reading library on your Mac.

This repository is a hackathon prototype. It is suitable for local evaluation and demos, but it has not been hardened or validated as a production service.

## What you need

- macOS, Linux, or Windows with Node.js 22.13 or newer
- A Chromium-based browser that can load an unpacked extension
- An [OpenRouter](https://openrouter.ai/) API key for generated briefs and follow-up chat
- An [Exa](https://exa.ai/) API key for related-source search

Both provider keys are optional. Without OpenRouter, Margin saves a clearly labelled extractive digest. Without Exa, it saves the original source without external enrichment.

An explicit question about your saved research can add up to three relevant original sources from completed, non-demo briefs in the local library. That local lookup does not call Exa unless the question also asks for web, external, latest, or current research.

## Build and run

```bash
npm install
npm run build
npm start
```

Open [http://localhost:4317](http://localhost:4317). In **Settings**, add your OpenRouter and Exa keys. Keys stay with the local server and are not bundled into the Chrome extension.

Load the extension in Chrome:

1. Open `chrome://extensions` and enable **Developer mode**.
2. Choose **Load unpacked** and select this repository's `dist/extension` directory.
3. Open the extension setup and paste the pairing code shown by the local Margin library.
4. Choose any readable web tab and select a passage if desired.
5. Click **Open assistant**. Chrome asks for access to that exact site during the click, then Margin opens as a draggable floating panel over the chosen page.
6. Start research. The completed result remains a draft until you choose **Add to library** or explicitly ask the assistant to save the brief.
7. Open the local library to revisit saved briefs, edit notes, or mark favorites.

The background queue continues after the capture request finishes, provided the local server remains running. Reusing a request ID does not create a second brief.

## Provider configuration

The Settings screen is the simplest option. For environment-based setup, copy `.env.example` to `.env` and fill in the keys:

```bash
cp .env.example .env
npm start
```

OpenRouter is the default provider endpoint, using `deepseek/deepseek-v4-flash-0731`. Requests to that exact model disable its optional reasoning mode so the bounded output budget is available for the brief and chat response. Another OpenAI-compatible HTTPS endpoint can be configured through `LLM_BASE_URL`; a local HTTP endpoint is accepted only on `localhost` or `127.0.0.1`.

Provider calls use your own accounts and may incur charges. Automated tests always use fake providers and make no paid calls. A user-authorized live check retrieved Exa sources, generated a DeepSeek brief from the saved evidence, answered a source-grounded question inside the real floating extension, and explicitly saved that brief through chat. See [verification details](docs/verification.md). A configured indicator means a key is saved; provider rejection, citation validation failure, or insufficient credit is reported on the affected research job.

## Capture boundaries

- Ordinary articles are extracted from the tab you select using readable page content, even while that tab stays in the background.
- A text selection scopes the brief to that passage.
- The floating panel can be dragged, collapsed, expanded, and closed. Opening the assistant again restores it, including its saved position. Each tab keeps its own current research context.
- The panel belongs to the current page document. Normal navigation removes it; click **Open assistant** again on the new page.
- Social sites capture only posts and replies already loaded in the page DOM. Margin does not auto-scroll or read an account's full history.
- arXiv abstract pages are marked abstract-only unless the local server resolves a usable HTML or text version.
- Chrome's built-in PDF viewer cannot host the injected floating panel or provide trustworthy generic PDF text. arXiv PDF URLs fall back to Chrome's native side panel and use the arXiv-specific server resolver; generic PDFs remain unsupported, so open an HTML article page instead.
- Source `S0` (shown as citation 1 in the UI) is always the captured original. Original-source findings cite only `S0`; an external connection must cite both `S0` and its related source.

Citation validation checks source identifiers and the structure of comparisons; it does not prove that each generated claim is supported. Open the saved excerpts to inspect the evidence. Page text, retrieved documents, and research questions are treated as untrusted input. The local API accepts the paired bearer token from the library or a valid Chrome extension origin, and rejects unrelated web origins.

## Development checks

```bash
npm test
npm run build
# or both:
npm run check
```

The automated suite uses temporary local databases and fake providers. It covers extraction, URL safety, source provenance, bounded synthesis repair, detached queue work, idempotency, cancellation, explicit library saves, fallback labeling, persistence, and pairing guards.

The browser smoke check exercises the built local library in a clean temporary profile and database. It does not require the unpacked extension or provider keys. It uses installed Chrome when available, then falls back to Playwright Chromium:

```bash
npm run test:browser
```

The isolated extension check loads the unpacked build in a fresh Chromium profile, grants only its synthetic fixture origin, intercepts every local API request, and verifies floating-panel capture plus per-tab state without touching provider accounts or your library:

```bash
npm run test:extension
```

That automated check verifies the native side-panel fallback for arXiv and generic PDF tabs. It grants its synthetic article origin directly, so Chrome's visible permission prompt remains a manual browser-owned interaction to verify when packaging the demo.

## Repository origin and dependencies

The application source, extension source, tests, documentation, and build script in this repository were created for the current hackathon build. Third-party packages remain under their own licenses; see `package.json` and `package-lock.json` for the exact dependency inventory and versions. No claim is made that third-party package code was authored for this project.

For the presentation path, use the [two-minute demo script](docs/demo-script.md).
