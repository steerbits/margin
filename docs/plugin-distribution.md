# Plugin distribution and contributions

Margin keeps official plugins in its main repository and leaves new plugin folders local by default. This document describes that Git workflow and recommendations for a future community directory. The community repository, official/community UI labels, and automatic installation or updates are not implemented.

## Official, community, and local plugins

| Category | Source location | Maintenance |
| --- | --- | --- |
| Official | Margin's main repository, explicitly included in `.gitignore` | Accepted and maintained by Margin maintainers |
| Community | The author's repository; installed copies are ignored by Margin's Git repository | The author |
| Local experiment | A local `plugins/<id>/` directory, ignored by Margin's Git repository | The local developer |

Official status means Margin accepts responsibility for maintaining and distributing the plugin. A community author can contribute an official plugin through a PR if Margin's maintainers accept that responsibility. Inclusion in a community directory alone does not make a plugin official.

Keep names descriptive: `project-notes` does not need to become `official-project-notes` or `margin-official-project-notes`. Keep published IDs stable when ownership or distribution changes. IDs are used in storage namespaces and panel links; renaming the Notes ID would require migrating its saved data and handling existing links.

For new community plugins, prefer an author prefix such as `alice-task-board` to reduce collisions. Directory names and plugin IDs should match and use the supported lowercase letters, digits, and hyphens, starting with a letter. Prefixes are a naming convention, not a verified identity or a guarantee of uniqueness.

## Notes on a fresh installation

Project Notes is bundled under `plugins/project-notes/` and enabled automatically after the normal installation, build, and startup. Select a workspace and click **Notes** to open the panel; no manual enable step or agent session is required. Enabled does not mean the panel opens automatically.

The committed `margin.plugins.json` contains:

```json
{
  "version": 1,
  "disabled": []
}
```

Plugins are enabled unless their folder ID is in `disabled`. A missing preferences file also defaults to an empty disabled list. A user who disables Notes through **Customize Margin → Plugins** keeps that choice across restarts; startup does not force it back on.

Plugin preferences are currently tracked in Git. Review `margin.plugins.json` before committing so a personal toggle does not accidentally change the defaults distributed to fresh installations. Keep Notes out of the shipped disabled list. Notes content and chats live in the ignored `.margin-data` directory and are not shipped with the plugin.

## Ship a plugin installed but disabled by default

An official plugin can ship with Margin while starting switched off. For a hypothetical `task-board` plugin, include its directory in the root `.gitignore` allowlist, keeping the existing Notes exception:

```gitignore
/plugins/*/
!/plugins/project-notes/
!/plugins/task-board/
```

Then add its folder ID to the committed `margin.plugins.json` disabled list:

```json
{
  "version": 1,
  "disabled": ["task-board"]
}
```

If other IDs are already disabled, preserve them when adding the new ID. Commit the plugin's source, the allowlist change, and `margin.plugins.json` together. Fresh installations will include Task Board and list it in **Customize Margin → Plugins**, but it will remain switched off. Users can turn it on there, then restart Margin and refresh the browser. Notes stays enabled because `project-notes` is absent from the disabled list.

The Git allowlist determines which plugin source ships; the disabled list determines which installed plugins run. Shipped defaults and personal toggle choices currently share `margin.plugins.json`, so editing it also changes the requested setting in your local installation. There is no separate user-settings override layer yet.

## Develop locally, then publish deliberately

The root `.gitignore` contains:

```gitignore
# Ignore new plugin folders.
/plugins/*/
# Include official plugins.
!/plugins/project-notes/
```

The leading `!` makes an exception to an earlier ignore rule. It makes files eligible for staging; it does not commit or push them. Git pushes commits, so local files are published only after they are committed and those commits are pushed.

1. Create an experiment in `plugins/my-experiment/` using the [extension APIs](extensions.md). Margin discovers ignored plugin folders as usual. Rebuild/restart as required for your development or production setup.
2. Keep developing locally. Ordinary `git add .` in the Margin repository skips the ignored folder. Git ignore rules do not affect already tracked files, including edits to Notes, and an explicit force-add can bypass them.
3. To contribute it as an official plugin, add `!/plugins/my-experiment/` below the ignore rule, review its code, documentation, and dependencies, and run the relevant checks and build. If this began as a separate repository, import its source files rather than staging an embedded Git repository.
4. Stage the allowlist change, plugin files, and any necessary supporting changes explicitly, then review the staged diff:

   ```sh
   git add .gitignore plugins/my-experiment/
   git diff --cached
   ```

5. Commit and submit the change for inclusion in Margin. Once accepted, publishing the main branch distributes it with Margin. No folder rename is required.

The ignore rule covers plugin directories, not host changes, dependency files, tests elsewhere in the repository, or `margin.plugins.json`. Review those changes separately before committing.

Ignored experiments and installed community plugins are also excluded from Margin's code checkpoints. Keep their backups or version history in their own repository. Official tracked plugins continue to participate in normal Git history and Margin checkpoints.

## Proposed community directory

Create a separate repository such as `margin-community-plugins` containing links to author-owned plugin repositories. Start with a README directory; a structured index can follow when an installer needs one. Each entry should identify:

- Plugin ID and display name.
- Description and author/maintainer.
- Source repository and installation instructions.
- Release version or tag, supported Margin/plugin API versions, and any required dependencies.

Authors maintain their code and releases in their own repositories and submit a PR to add or update their listing. Directory maintainers review listings and can mark abandoned or incompatible entries. Listing a plugin does not transfer maintenance to Margin or guarantee its behavior.

Today, installation means copying the plugin source into `plugins/<id>/`, following its dependency instructions, and rebuilding/restarting Margin. The installed directory stays ignored by Margin's Git repository. An installed plugin is enabled unless its folder ID is disabled in `margin.plugins.json`; the Git allowlist controls distribution, not execution. Plugin code uses the existing trusted-code execution model described in the [extension guide](extensions.md).

For a future plugin UI, show labels such as **Official · by Margin** and **Community · by Alice** separately from display names. Derive official status from Margin's maintained list of bundled plugins, not from an author-supplied name or `official: true` field. These labels and a community installer remain future work.
