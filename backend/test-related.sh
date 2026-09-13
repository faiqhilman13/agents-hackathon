#!/usr/bin/env bash
#
# Smoke-test the Cortex backend with curl.
#
# Usage:
#   ./test-related.sh                                  # tests http://localhost:3000
#   ./test-related.sh https://your-app.vercel.app      # tests a deployment
#   BACKEND_URL=https://your-app.vercel.app ./test-related.sh
#
# (On Windows, run this from Git Bash or WSL.)
# If `jq` is installed the JSON output is pretty-printed.

set -euo pipefail

BACKEND_URL="${1:-${BACKEND_URL:-http://localhost:3000}}"
BACKEND_URL="${BACKEND_URL%/}" # strip trailing slash

pretty() {
  if command -v jq >/dev/null 2>&1; then jq .; else cat; echo; fi
}

echo "== 1. GET $BACKEND_URL/api/health"
curl -sS "$BACKEND_URL/api/health" | pretty

echo
echo "== 2. OPTIONS preflight (should show Access-Control-Allow-Origin: *)"
curl -sS -i -X OPTIONS "$BACKEND_URL/api/related" \
  -H "Origin: https://example.com" \
  -H "Access-Control-Request-Method: POST" | grep -i "^access-control" || echo "!! No CORS headers found"

echo
echo "== 3. POST $BACKEND_URL/api/related  (calls Exa + OpenRouter, takes a few seconds)"
curl -sS -X POST "$BACKEND_URL/api/related" \
  -H "Content-Type: application/json" \
  --max-time 40 \
  --data-binary @- <<'JSON' | pretty
{
  "url": "https://example.com/four-day-work-week",
  "title": "The four-day work week is coming for knowledge workers",
  "text": "A growing number of companies are experimenting with a four-day work week, cutting hours without cutting pay. Early trials in the United Kingdom, Iceland and New Zealand reported that productivity held steady or improved, while employee burnout and sick days fell sharply. Advocates argue that most knowledge work is not bound by hours at a desk, and that compressing the week forces teams to cut low-value meetings and focus on output. Critics counter that the trials were self-selected, that results may fade once the novelty wears off, and that the model is hard to apply to hospitals, schools, retail and manufacturing, where coverage matters more than output. Economists also point out that the historical shift from six-day to five-day weeks took decades and was driven by labor movements and legislation rather than voluntary corporate pilots. The debate now centers on whether shorter weeks are a durable productivity gain or a perk that only thrives in a tight labor market."
}
JSON
