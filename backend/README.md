# Cortex backend

One main HTTP endpoint. It takes what the user is reading and returns 3 ranked source cards.

```
POST /api/related
  in : { url, title, text }
  out: { suggestions: [{ title, url, source, highlight, whyItMatters }, x3] }

GET /api/health
  out: { ok: true }
```

## What it does

`api/related.js` validates the request, then runs two steps:

1. **Exa neural search** ([lib/exa.js](lib/exa.js)): semantic search over the web, using the article's title plus its first 600 characters as the query. It returns 8 candidate pages, each with a 2-sentence highlight.
2. **LLM ranking** ([lib/rank.js](lib/rank.js)): GPT-4o-mini via OpenRouter picks the 3 sharpest candidates and writes a one-line "why this matters" for each. The prompt aims for a canonical source, the strongest counter-argument, and an unexpected connection. The model returns only candidate numbers, so titles and URLs always come from Exa. If the LLM fails, Exa's top 3 are returned instead.

[lib/http.js](lib/http.js) adds CORS headers to every response and answers `OPTIONS` preflights.

## Setup (5 minutes)

Requires Node.js 20.6 or newer.

```bash
cp .env.example .env       # fill in EXA_API_KEY and OPENROUTER_API_KEY
npm install
npm run dev                # → http://localhost:3000 (no Vercel login needed)
```

`npm run dev` loads `.env` and serves the same handlers Vercel runs. To use Vercel's own emulator instead, run `npm run dev:vercel`.

Test it in a second terminal (Git Bash or WSL on Windows):

```bash
chmod +x test-related.sh
./test-related.sh
```

You should see `{"ok":true}`, the CORS headers, and then JSON with 3 suggestions.

## Get keys

- **Exa**: [dashboard.exa.ai](https://dashboard.exa.ai) → sign in → API keys → create key. Check the dashboard for current free-tier limits.
- **OpenRouter**: [openrouter.ai/keys](https://openrouter.ai/keys) → generate a key. Add a few dollars of credit; gpt-4o-mini is inexpensive, so a small top-up should last the hackathon.

## Deploy

```bash
npx vercel                          # first time: log in and link the project
npx vercel env add EXA_API_KEY
npx vercel env add OPENROUTER_API_KEY
npx vercel --prod
```

You can also add the two env vars in the Vercel dashboard (Settings → Environment Variables) and redeploy. Then copy the deployed URL into `extension/config.js`.

## Layer 2 (personalization): do this after Layer 1 works

Add an `/api/log` endpoint that stores `{ userId, url, title, timestamp }`. Then change `/api/related` to load the user's last 20 reads and pass them into the LLM prompt, so the ranking becomes personal. This is the "you read this 3 weeks ago" card in the mockup, and it's what separates Cortex from Perplexity.

Note: Vercel functions can't write to local files that persist between requests. Use a store such as Vercel KV, Upstash Redis, or Supabase for the reading log.

## Common errors

| Symptom | Cause | Fix |
|---------|-------|-----|
| `500 Server is missing EXA_API_KEY` | `.env` missing or not loaded | Create `backend/.env`, then restart `npm run dev` |
| `502 Related-source search failed` with a 401 detail | Exa key wrong | Check `.env`; no quotes or spaces around the key |
| Cards say "Closely related coverage from…" | OpenRouter key missing, wrong, or out of credit | Check `OPENROUTER_API_KEY` and your OpenRouter balance; the server log shows the LLM error |
| `400 "text" is required…` | Article text under 200 characters | Test with a longer article |
| Empty `suggestions` array | Exa returned nothing | Try a longer or more substantive article |
| CORS error in browser | Headers missing | Run `./test-related.sh` and confirm `Access-Control-Allow-Origin: *` |
