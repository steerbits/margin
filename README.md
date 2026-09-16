# Margin

A human-first harness that uses your existing agents.

## What makes it human-first and special

- **Designed to elicit volumes of feedback from humans**
    - Inline comments for AI replies (Google-docs style) implicitly pushes you to give more feedback
    - Generated artifacts (markdown or html files or web app) have a point-and-click detailed annotation
- **AI shapes the task with you before executing**
    - Invites feedback, presents options, brainstorms with you
    - The output becomes distinctly yours (instead of AI default)
- **Sandboxed execution that isolates every workspace/project**
    - Your AI cannot write or execute files outside of current workspace
    - But it can ready anywhere on the system, allowing for fast, permissionless but safe execution of agreed upon plan
- **Extend Margin by asking AI to build what you want**
    - Margin supports plugins and customization of itself
    - Simply ask the agent what you want to get built and it'll customize a version for you

## Supported models

Margin is built on [Pi](https://github.com/earendil-works/pi), and hence supports alll models and subscriptions, including Codex/ChatGPT, Claude, Openrouter and even local models like Qwen.

A personal, local browser interface for Pi. Read Markdown, select a passage, collect comments in the margin, and send them with an overall reply. A chosen Pi skill drives the workflow.

## Install and run

The first installer targets native **macOS** with Node **22.19+** (Node 24 LTS recommended), npm, and Git. Clone this repository into its own folder, then run:

```sh
bash install.sh --start
```

The installer installs locked dependencies, builds Margin, verifies the real filesystem sandbox, and starts the app. Pi **0.85.1** and a pinned cco copy are included; no separate global Pi or cco installation is required. It leaves global Node/Git/Pi installations alone and refuses to replace existing dependency/build directories. Later starts use `bash start.sh`.

## About

Margin is built by [@paraschopra](x.com/paraschopra) and thanks the following projects

- [Pi](https://github.com/earendil-works/pi) for the SDK that powers the agent and connectors
- [CCO](https://github.com/nikvdp/cco) for the sandbox to allow safe execution of agents

## Margin is WIP, and currently meant for technical audience

Please expect things to break. It is a very early release. Feedback welcome via Github issues.

Feature ideas and priorities are maintained in [BACKLOG.md](BACKLOG.md).
