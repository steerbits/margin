# Margin plugins

Place trusted plugins in subdirectories containing `server.ts`, `client.tsx`, or both. See [the extension guide](../docs/extensions.md).

Included and enabled by default: [Project notes](project-notes/README.md), a Notes panel with one explicitly saved notepad per project. A fresh installation needs no manual plugin toggle; after the normal build/start, select a workspace and click **Notes**.

Checked-in plugin directories are discovered automatically when the server starts and the browser bundle is built, so a clone of this version includes Notes. Enabled state is controlled by `margin.plugins.json` through **Customize Margin → Plugins**, with changes taking effect after restart. Saved notes and chats are in the ignored `.margin-data` directory and are not included by Git.

New plugin directories are ignored by Git by default, but Margin still discovers them locally. Official plugins are explicitly included in the root `.gitignore`. Ignored plugins are also excluded from Margin's code checkpoints, so keep experiments backed up or versioned in their own repository. See [plugin distribution and contributions](../docs/plugin-distribution.md) for publishing steps and the proposed community directory.
