# Working on Margin

Read `README.md` for setup, architecture, contracts, commands, and current limitations. This repository contains a Chrome MV3 extension, React library/panel/popup, and local Express/SQLite backend. Start commands from the repository root.

## Orientation

- Browser capabilities: `extension/`; panel UI: `src/Assistant.tsx`; popup: `src/popup.tsx`.
- Library: `src/App.tsx`; client/settings: `src/api.ts`, `src/Settings.tsx`.
- Queue/providers/chat: `server/research.ts`, `server/providers.ts`, `server/chat.ts`.
- Contracts: `shared/schema.ts`, `extension/messages.ts`; persistence/config: `server/store.ts`, `server/settings.ts`.
- Build: `npm ci`, then `npm run build`. Generated output is `dist/extension`; edit source instead.
- Run: `npm start` at `http://127.0.0.1:4317`. `npm run dev` watches the server only.
- Validate: `npm run check`; for UI/browser changes also run the relevant `test:browser`/`test:extension` command after installing Playwright Chromium.

## Invariants

- New research has `inLibrary: false`. Only explicit saves promote it; ordinary answers and notes do not implicitly save drafts.
- Bind each floating panel to its owning tab and check the page URL before restoring context.
- Site permissions and native PDF `sidePanel.open` must retain the originating user gesture.
- Queue jobs live in Node and survive overlay closure. Preserve cancellation and interrupted-job behavior.
- `S0` is original evidence; overview/takeaways cite it alone, connections cite it plus related sources. Structural validation is not factual verification.
- Keep credentials server-side. Never commit `.data`, `.env`, build output, or private browser profiles.
- Automated tests use temporary stores and fake/intercepted providers. Do not clear or use a user's library as a test fixture.
- Default model: `deepseek/deepseek-v4-flash-0731`. Its reasoning override is deliberately limited to that exact model on OpenRouter.

## Handoff

Report changed files, configuration assumptions, tests actually run, live-call boundaries, and remaining manual setup. After extension changes, rebuild, reload in Chrome, refresh old injected pages, and reopen the assistant. Do not assume another agent's running server or paired browser exists on the next machine.
