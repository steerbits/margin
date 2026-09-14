# Artifact review

Margin has a shared, browser-like review window for generated Markdown, HTML, and supported HTTP localhost apps. It is a core customization with separate viewer/preview modules, not an independently installable plugin. The existing v1 plugin API cannot supply this placement, preview transport, and chat delivery by itself. Future file-browser/editor entry points can reuse the review surface and artifact references; a public third-party viewer registration API is not implemented yet.

## Use it

After rebuilding/restarting Margin, **click the agent's generated file or local-app link directly in its reply**. Workspace `.md`, `.markdown`, `.html`, `.htm` links (relative, absolute, or local `file:` links) and HTTP localhost app links open in the review wrapper automatically on click. Nothing pops open merely because a reply arrives. Ordinary remote website/documentation links remain ordinary links; Margin's own origin is not treated as a generated app.

The **Artifacts** toolbar button reopens this conversation's existing reviews. There is no manual path/URL input in the review UI. Files still must be inside the workspace, and an app must already be running.

The agent also receives `present_artifact({ location, title? })`. It registers the output and returns a review link; it does not start the app, inject source code, open a window, poll for feedback, or spend model calls waiting. Its tool card and review links open the overlay from the current conversation. **Open in new window** uses the same surface at `/review/<conversation UUID>?artifact=<artifact UUID>`; the browser may choose a tab instead of a window.

- The read-only address bar shows the original file or app URL, not the proxy address.
- **Use app/document** allows normal interaction and text selection. Selecting text creates a draft in the adjacent feedback area.
- **Point to comment** captures an element instead of activating it. The runtime bridge intercepts pointer/click activation before app scripts; Enter/Space selects the focused element. Escape inside the app exits pointing mode.
- **Comment on this page** creates a page-specific comment card. When the bridge is connected, it captures the live route at the instant you click—not a cached address or whichever page is open when you send. The fallback uses the last known/registered page if the bridge is unavailable. Page feedback is distinct from the overall feedback box.
- **Save** adds a comment to the pending feedback batch; **Edit** reopens it for writing. Unfinished typing is still automatically preserved as a recovery draft, but it is not attached until saved. Legacy nonempty draft comments remain attached after upgrading. Empty selections do not block sending.
- Closing/reopening preserves comments, overall text and the selected artifact. Exact live app state is not restored after closing/reloading. Missing/changed targets retain their saved quotation, route and comment; there is no Retarget control, automatic deletion or automatic resolution.
- **Overall feedback** is about the entire review. It can be sent by itself or with attached comments. It has separate storage from the main chat composer, with mutation IDs, revisions, failed-save recovery and explicit conflict choices if another window changes the text. Accepted feedback clears only the submitted overall version, never newer writing.
- **Send feedback** includes all saved, nonempty review comments across this conversation's artifacts, labelled by their source, plus the overall text. The attached count no longer depends on which artifact is on screen. Unfinished nonempty comments must be saved before sending; the UI explains this. It also explicitly explains connection, working-agent and pending-dialog blocks. Background queuing/steering is not implemented.
- **Open original** opens the registered app directly, or serves the original file without the bridge. Original Markdown is plain text; original HTML retains its local assets.
- Explicit deletion removes the review annotation from the UI. Feedback already sent remains in the conversation history.

## Where data lives

Artifacts, annotations, deletion tombstones and frozen feedback batches are stored in the existing workspace SQLite database as an `artifact-review` record keyed by the Margin conversation UUID. Default source-workspace storage is `.margin-data/margin.sqlite`; external workspaces use `.margin-data/workspace-data/<workspace UUID>/margin.sqlite`. `MARGIN_DATA_DIR` changes the storage root. Normal workspace migration copies these records with the rest of that conversation's data.

No feedback folders, annotation files, script tags, or build changes are written into generated projects. Chat deletion removes its server-side artifact records and closes active previews. Sent feedback also exists in the native Pi transcript, as ordinary user input.

The browser keeps per-mutation recovery records in localStorage until server acknowledgment. These are browser data, not workspace files. Failed saves remain visible and retryable. Saving uses per-comment revisions plus mutation IDs: delayed requests cannot overwrite a newer acknowledged edit; retrying an acknowledged mutation is idempotent. If another review window changed/sent the same comment, the unsaved version is retained as a separate draft rather than overwriting it. Local storage/disk failure still cannot offer an absolute no-data-loss guarantee; errors instruct the user to keep the window open until saving succeeds.

## Architecture

```text
Agent tool / Artifacts button / review link
                 |
   Reusable ArtifactReviewWindow (Margin origin)
   address + controls + draft editor + batch send
                 |
       isolated iframe (separate port)
                 |
       workspace-owned preview service
       / Markdown rendered to HTML
       / static HTML + local assets
       / reverse proxy to one registered local app
                 |
   runtime-only annotation bridge in served HTML
                 |
   validated origin + frame + channel messages
```

`shared/artifacts.ts` is the artifact/anchor contract. `server/artifacts.ts` handles registration, scoped file validation, comment revisions and frozen batches. `server/artifact-preview.ts` owns transient loopback listeners, serving and proxying. `server/artifact-bridge.js` is inserted into HTTP responses only. `src/ArtifactReview.tsx` provides the shared surface and `src/artifact-drafts.ts` provides recovery/concurrency handling. The same authenticated session send path performs both chat and artifact submissions, preserving preflight, interruption handling and customization checkpoints. Artifact feedback appears as a compact expandable batch in chat.

A target contains a quote, surrounding text, a DOM-selector hint, the selected route, and a fingerprint of the served document. This is rendered-content evidence—not a guarantee of a source-code line mapping, a screenshot, or a replay of JavaScript state. Text resolution refuses ambiguous matches; element resolution requires a unique selector and matching description.

## Safety and compatibility boundaries

- Generated artifacts/apps are trusted local content. Preview isolation is not a sandbox for arbitrary hostile websites or local backend services.
- Preview listeners bind to loopback only and require an unguessable start capability plus an HttpOnly preview cookie. Do not share capability links. Each preview exposes supported non-hidden resources within its workspace; it is not limited to one file's bytes. There are no directory listings, hidden files, `node_modules`, unsupported files or symlink escapes in the static server.
- The proxy target is fixed at creation: HTTP `localhost`/`127.0.0.1` with an explicit port >=1024. Margin and preview ports are refused. Redirects outside the registered app origin are refused rather than followed.
- HTTP requests do not forward browser Cookie/Authorization headers to the generated app. Cookie-based/authenticated apps are not supported in this first version. Margin's authenticated JSON APIs remain on their own origin; a preview cannot read them through the bridge.
- The iframe permits scripts, forms and explicit popup windows, but not navigation of the outer Margin window. Popup links are ordinary app/browser behavior, not additional authenticated Margin APIs.
- CSP and framing restrictions from an upstream app are preserved, not silently removed. A bridge timeout explains unsupported/offline apps. Hard-coded origins, service workers, nested cross-origin frames, canvas/WebGL hit-testing, forced compressed HTML, complex authenticated flows and arbitrary frameworks are not guaranteed to work.
- Vite's ordinary relative assets, module loading, modal interaction and hot-reload WebSocket path were exercised. Runtime injection does not imply universal proxy compatibility.
- Limits: 100 artifacts and 1,000 annotation records per conversation (including deletion tombstones), 200 comments per submitted batch, 90 KB feedback payload, 5 MB proxied HTML, 32 MB static resources and 24 simultaneously active previews per workspace worker. Closed annotated previews expire after ten idle minutes; open annotated pages keep their preview alive. Originals lack the heartbeat and can expire while left open.
- Image/PDF viewers, spatial screenshot comments, automatic adapter generation, automatic revision walkthroughs and a full file browser/editor are deferred.

## Verification

`tests/artifacts.test.ts` covers registration boundaries, durable drafts, optimistic concurrency, mutation retries, deletion tombstones, batch locks/rejection/recovery, cross-session isolation, runtime proxy credentials/CSP/redirects, clean originals, and browser recovery after failed saves.

`tests/browser/artifacts.spec.ts` exercises actual Chromium selection, ordinary agent output links without prior registration, click-only opening, Save/Edit, correct-conversation batch delivery, two saved comments across artifacts after close/reload, a page-specific route that survives navigating elsewhere, overall-only and combined sends, explicit agent-dialog blocking, a live Vite app with a modal, non-activating point selection, hot reload during an unfinished draft, original HTML remaining unmodified, a separate review window, failed network saves and explicit deletion. `tests/gateway-browser/artifacts.spec.ts` exercises the same surface through an external workspace worker.

These are automated fixtures with simulated agent replies, not evidence of user preference or live model editing quality. A self-review of the actual screenshot and implementation was performed; no independent reviewer was available. See the dated artifact-review entry in `docs/evaluation.md` for observed run results and remaining failures.
