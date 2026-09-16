# Artifact review

Margin has a shared, browser-like review window for generated Markdown, HTML, and supported HTTP localhost apps. It is a core customization with separate viewer/preview modules, not an independently installable plugin. The existing v1 plugin API cannot supply this placement, preview transport, and chat delivery by itself. Future file-browser/editor entry points can reuse the review surface and artifact references; a public third-party viewer registration API is not implemented yet.

## Use it

After rebuilding/restarting Margin, **click the agent's generated file or local-app link directly in its reply**. Workspace `.md`, `.markdown`, `.html`, `.htm` links (relative, absolute, or local `file:` links) and HTTP localhost app links open in the review wrapper automatically on click. Nothing pops open merely because a reply arrives. Ordinary remote website/documentation links remain ordinary links; Margin's own origin is not treated as a generated app.

The **Artifacts** toolbar button reopens this conversation's existing reviews. It stays hidden until the conversation has registered artifacts. Ordinary output links still open the wrapper directly; registration makes the toolbar button available without a reload. There is no manual path/URL input in the review UI. Files still must be inside the workspace, and an app must already be running.

The agent also receives `present_artifact({ location, title? })`. It registers the output and returns a review link; it does not start the app, inject source code, open a window, poll for feedback, or spend model calls waiting. Its tool card and review links open the overlay from the current conversation. **Open in new window** uses the same surface at `/review/<conversation UUID>?artifact=<artifact UUID>`; the browser may choose a tab instead of a window.

- The read-only address bar shows the original file or app URL, not the proxy address.
- **Use app/document** allows normal interaction and text selection. Selecting text creates a draft in the adjacent feedback area.
- **Point to comment** captures an element instead of activating it. The runtime bridge intercepts pointer/click activation before app scripts; Enter/Space selects the focused element. Escape inside the app exits pointing mode.
- **Comment on this page** creates a page-specific comment card. When the bridge is connected, it captures the live route at the instant you click—not a cached address or whichever page is open when you send. The fallback uses the last known/registered page if the bridge is unavailable. Page feedback is distinct from the overall feedback box.
- **Save** adds a comment to the pending feedback batch; **Edit** reopens it for writing. **⌘Enter / Ctrl+Enter** in a comment editor performs the same Save action (not Send); plain Enter stays multiline. Unfinished typing is still automatically preserved as a recovery draft, but it is not attached until saved. Legacy nonempty draft comments remain attached after upgrading. Empty selections do not block sending.
- Click outside the overlay, use its close button, or press Escape outside the embedded app to dismiss it. A drag that starts inside the window and ends outside does not dismiss it. Closing/reopening preserves comments, overall text and the selected artifact. Exact live app state is not restored after closing/reloading. Missing/changed targets retain their saved quotation, route and comment; there is no Retarget control, automatic deletion or automatic resolution.
- **Overall feedback** is about the entire review. It can be sent by itself or with attached comments. It has separate storage from the main chat composer, with mutation IDs, revisions, failed-save recovery and explicit conflict choices if another window changes the text. Accepted feedback clears only the submitted overall version, never newer writing.
- **Send feedback** includes all saved, nonempty review comments across this conversation's artifacts, labelled by their source, plus the overall text. The attached count no longer depends on which artifact is on screen. Unfinished nonempty comments must be saved before sending; the UI explains this. It also explicitly explains connection, working-agent and pending-dialog blocks. Once the batch is **accepted**, the overlay closes and chat scrolls to the latest activity, so you see processing begin rather than waiting for the agent's response to finish. A standalone review navigates to its associated chat. HTTP failures and rejected submissions leave the review open with feedback preserved; an HTTP `submitting` response alone does not count as acceptance. Background queuing/steering is not implemented.
- **Open original** opens the registered app directly, or serves the original file without the bridge. Original Markdown is plain text; original HTML retains its local assets.
- Explicit deletion removes the review annotation from the UI. Feedback already sent remains in the conversation history. Sent annotations are kept under the initially collapsed **Previous feedback** section, pinned directly above the overall box, outside the active-comment scroller. Expanded history has bounded scrolling so the overall box and Send stay accessible. History is filtered to the current registered artifact and displayed path/query/hash; changing the artifact or URL updates the default count and list. Before the preview reports its live URL, its entry route is used. Expand it to revisit the original quotation and comment, even after that page's content changes. If the artifact has more sent comments than the current page, expanded history offers **All previous feedback (N)** to show them across URLs, with a **This page only (N)** action to return. The link is absent when both sets are the same, including ordinary single-page Markdown reviews. A current page with zero comments still exposes the expandable section if that artifact has history elsewhere. All mode resets on navigation or collapse, does not navigate the preview, and never includes another artifact's notes. History filtering does not change the conversation-wide unsent attachments or their send count. Updates do not automatically resolve old notes; unfinished and saved unsent drafts remain visible.

## Where data lives

Artifact references (title, kind and location—not copies of the generated files), annotations, deletion tombstones and frozen feedback batches are stored in the existing workspace SQLite database as an `artifact-review` record keyed by the Margin conversation UUID. Default source-workspace storage is `.margin-data/margin.sqlite`; external workspaces use `.margin-data/workspace-data/<workspace UUID>/margin.sqlite`. `MARGIN_DATA_DIR` changes the storage root. Normal workspace migration copies these records with the rest of that conversation's data.

No feedback folders, annotation files, script tags, or build changes are written into generated projects. Chat deletion removes its server-side artifact records and closes active previews. Sent feedback also exists in the native Pi transcript, as ordinary user input.

The browser keeps per-mutation recovery records in localStorage until server acknowledgment. These are browser data, not workspace files. Failed saves remain visible and retryable. Saving uses per-comment revisions plus mutation IDs: delayed requests cannot overwrite a newer acknowledged edit; retrying an acknowledged mutation is idempotent. If another review window changed/sent the same comment, the unsaved version is retained as a separate draft rather than overwriting it. Local storage/disk failure still cannot offer an absolute no-data-loss guarantee; errors instruct the user to keep the window open until saving succeeds.

The default `.margin-data/` directory and these generated examples under `workspaces/` are Git-ignored and excluded from code-history checkpoints. Artifact files themselves stay at their original locations: a generated file elsewhere in a Git-tracked source directory follows that project's Git rules. Registering/reviewing it does not change those rules or add annotation code.

## History lock when sending

In Margin's own source workspace, both main-chat sends and artifact-feedback sends pass through the same automatic **Before customization** code checkpoint. “Another history operation is running” comes from `.margin-data/history/operation.lock`, not an artifact-comment SQLite lock. The checkpoint must succeed before the feedback is handed to the agent.

A normally completed or failed checkpoint releases its lock. The existing implementation recovers a lock whose recorded process is confirmed dead on retry; it does not remove a lock belonging to a potentially live process. Restarting is not normally necessary. An earlier reported persistent block could not be diagnosed because its lock/owner was no longer present when inspected. Do not blindly delete a live lock or bypass the checkpoint guard, because a restore may be in progress.

That earlier report is distinct from the September 16 incidents, where live process samples and a reproduction identified a stalled Git input pipe during capture. The shared checkpoint path now uses regular-file input and a five-second limit per Git command. See [checkpoint behavior and improvements](checkpoints.md) for the evidence, current limits, and recovery design.

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

`tests/browser/artifacts.spec.ts` exercises actual Chromium selection, ordinary agent output links without prior registration, click-only opening, empty-launcher visibility, Save/Edit, acceptance-gated return to the processing chat, failure/rejection preservation, collapsed sent history after a file update, bottom-pinned page-specific history with scrolling and a narrow viewport, artifact/path/query/hash filtering without dropping unsent attachments, correct-conversation batch delivery, two saved comments across artifacts after close/reload, a page-specific route that survives navigating elsewhere, overall-only and combined sends, explicit agent-dialog blocking, a live Vite app with a modal, non-activating point selection, hot reload during an unfinished draft, original HTML remaining unmodified, a separate review window, failed network saves and explicit deletion. `tests/gateway-browser/artifacts.spec.ts` exercises the same surface through an external workspace worker.

These are automated fixtures with simulated agent replies, not evidence of user preference or live model editing quality. A self-review of the actual screenshot and implementation was performed; no independent reviewer was available. See the dated artifact-review entry in `docs/evaluation.md` for observed run results and remaining failures.
