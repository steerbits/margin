# Local plugins

Place trusted plugins in subdirectories containing `server.ts`, `client.tsx`, or both. See [the extension guide](../docs/extensions.md).

Included: [Project notes](project-notes/README.md), a Notes panel with one explicitly saved notepad per project.

Checked-in plugin directories are discovered automatically when the server starts and the browser bundle is built, so a clone of this version includes Notes. Enabled state is controlled by `margin.plugins.json` through **Customize Margin → Plugins**, with changes taking effect after restart. Saved notes and chats are in the ignored `.margin-data` directory and are not included by Git.
