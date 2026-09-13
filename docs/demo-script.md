# Margin two-minute demo

Prepare before presenting: run `npm run build && npm start`, load `dist/extension` as an unpacked Chrome extension, pair it with the local library, and grant access to the demo site. Use a public article with a clear title and enough readable text. If you plan to show live enrichment, run a small real brief first; a configured indicator only means the key has been saved; otherwise use the built-in demo brief and describe it as illustrative.

## 0:00–0:20 — Start beside the source

Choose the article in the extension popup and click **Open assistant**. Grant access to that site when Chrome asks, then move the floating Margin panel beside the passage you want to discuss.

Say: “Margin stays beside what I am reading. I choose the page it can access, and the original becomes source 1.”

Point out the detected title and capture scope. If a passage is selected, say that the result is limited to that passage.

## 0:20–0:50 — Send research to the background

Enter a focused question, keep related-source enrichment enabled, and start the research.

Say: “The capture returns immediately while the local queue continues the work. Closing the panel does not discard the job, as long as the local server keeps running.”

Reopen the panel to show that it returns to its saved position. Keep the draft open there while it is queued or running.

## 0:50–1:25 — Read the evidence boundaries

Open a completed brief. Show the overview, takeaways, and sources.

Say: “Claims about the page cite source 1. A connection to outside work must cite the original and the related source, so the comparison remains visible and checkable.”

Call out any scope warning, such as abstract-only, selected passage, visible social content, or extractive fallback. Do not describe the built-in demo as a live provider result.

## 1:25–1:50 — Keep the useful part

Choose **Add to library** in the completed panel. Open the local library at `http://localhost:4317`, add a short note, and mark the brief as a favorite. Move away and reopen it from the library.

Say: “The brief, notes, collection, and favorite state live in the local SQLite library and remain after the server restarts.”

If a live model is connected, ask one follow-up question grounded in the displayed sources.

## 1:50–2:00 — Close on control

Say: “Margin reads only the tab and sites I grant, keeps provider keys in the local server, and tells me when it had only a selection, abstract, or loaded social content.”

End on the source list rather than a generated paragraph: the demo's key idea is inspectable research provenance.
