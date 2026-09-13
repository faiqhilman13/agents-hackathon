# Prototype verification

Checked locally on 13 September 2026.

## Automated checks

- Production TypeScript, Vite, and MV3 build passed.
- 25 domain and HTTP tests passed with temporary databases and fake providers.
- Library browser check passed: example creation, source display, note persistence, and searching notes.
- Isolated Chromium extension check passed: real floating iframe on a page with a restrictive frame CSP, selected background-tab capture, collapse and expansion, drag persistence, close/reopen restoration, independent tab context, new-conversation cleanup, and native side-panel fallback for PDF routes.
- The collapsed host shrinks to its visible header, and the expanded panel remains inside the viewport.
- Dependency audit returned no vulnerabilities.

The extension harness grants only its synthetic origins. Chrome's native optional permission prompt is not automated. It intercepts its API requests and never uses live provider credentials or the user's library.

## Live provider and interaction check

The original source was the public [Chrome extension service-worker lifecycle documentation](https://developer.chrome.com/docs/extensions/develop/concepts/service-workers/lifecycle).

1. A real local queue job planned searches and retrieved related Chrome documentation through Exa.
2. The saved original and retrieved evidence were reused for DeepSeek synthesis to avoid repeating the searches. The selected model was `deepseek/deepseek-v4-flash-0731` through OpenRouter. The generated brief contained five takeaways, four connections, and five retained sources including the original.
3. A fresh Chromium profile loaded the actual extension and restored that draft in a floating panel over the original documentation page.
4. A question about the brief's recommendation to persist state returned a live DeepSeek explanation citing four saved sources. Asking the question left the brief unsaved.
5. Sending “Add this research brief to my library” through the floating panel triggered the agent's save action. The local API confirmed `inLibrary: true` and retained the four conversation messages.
6. The saved brief and conversation opened in the real local library.

The live browser check used a separate temporary profile and pre-granted access only to the public Chrome documentation origin. It did not install the extension into the user's everyday Chrome profile. Live checks required explicit user-supplied credentials; they are not part of the committed automated test scripts.

Citation validation establishes identifier and comparison consistency, not semantic entailment. Generic PDF text extraction and unloaded social-feed content remain outside this prototype's capture boundary.
