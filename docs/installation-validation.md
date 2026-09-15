# Native installer validation

Verified 15 September 2026 for the technical beta.

| Check | Result |
| --- | --- |
| Fresh installation into a separate directory | `install.sh --destination ... --port 49422 --prepare-only` completed dependency installation and the production build |
| Node checks | 194 tests passed, including private Pi storage, preservation, destination/symlink refusal, and rejection of tracked workspace files |
| Browser workflows | 26 selected provider-account, notes, and conversation tests passed on the final rerun |
| Gateway workflows | 11 tests passed, including external workspace creation and rejection of new projects inside Margin |
| Actual new gateway | The installer-selected port, separate browser cookie, private Pi directory, and empty saved provider accounts were verified |
| Source application | Changes applied in place; existing Git HEAD/checkpoint refs and stored project/session paths remained unchanged |

One browser panel-reload test failed during the initial concurrent run. It passed in isolation and in the final 26-test rerun without an application change for that failure; it remains an observed intermittent test result.

Tests and builds ran in disposable checkouts. The working installation's `.margin-data`, `.git`, workspaces, `node_modules`, and `dist` were not replaced, and its server was not restarted. There was no data migration or path rewrite. Previous versions of changed source files were retained separately before applying the update.

Workspace Git cleanup removed seven game files from Margin's index only. Their contents were verified unchanged, and both historical game commits were preserved in an independent repository inside the existing game folder. Margin's HEAD/history and the stored workspace location stayed unchanged. Existing nested workspaces remain supported; new projects belong outside the app source folder.

The owner subsequently reported that `npm run build` followed by `bash start.sh` worked from a normal Terminal. Since `start.sh` runs the real filesystem sandbox probe before launching the gateway, this confirms that native launch path on the owner's Mac. The preparing agent's parent sandbox still rejects `sandbox-exec` with `sandbox_apply: Operation not permitted`; that failure is never treated as a passing check or used to trigger an unsandboxed fallback.

Provider login and inference in the updated native installation remain user checks. The earlier Docker experiment passed the real Linux bubblewrap probe and container-replacement persistence checks; those results do not establish native macOS enforcement. Docker installation is deferred and documented separately.
