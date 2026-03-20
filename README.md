<div align="center">

# Open Office

### Pixel office for AI agents and multi-agent collaboration

[![npm version](https://img.shields.io/npm/v/open-office?color=cb3837&logo=npm)](https://www.npmjs.com/package/open-office)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![Node.js](https://img.shields.io/badge/Node.js-18+-339933?logo=node.js&logoColor=white)](https://nodejs.org/)
[![PRs Welcome](https://img.shields.io/badge/PRs-welcome-brightgreen.svg)](https://github.com/longyangxi/open-office/pulls)

**Support Claude, Codex, Gemini, Aider etc. — one team, getting better every project. 🚀**

> _Last tested: 2026-03-18_

[Quick Start](#quick-start) | [Features](#features) | [Team Workflow](#team-workflow) | [Architecture](#architecture) | [Contributing](#contributing)

</div>

---
![Image](https://github.com/user-attachments/assets/ecfcd88b-e72e-4b04-bdd7-87eea9f00b51)

## What is Open Office

Open Office gives AI automation a **visible, controllable workspace**. Different AI models collaborate as one team under a Team Leader — planning, coding, reviewing, and delivering in a single flow, all rendered in a live pixel-art office you can watch, control, and share.

What makes it different: **agents get better over time**. Rate each project on creativity, visual quality, interaction, completeness, and engagement. Your ratings and review patterns are stored as persistent memory — the next time the team plans a project, they know what scored low and actively improve on it.

## Quick Start

```bash
npx bit-office
```

That's it. This will:

1. Start a local gateway daemon
2. Open the pixel-art office UI in your browser
3. Auto-detect installed AI CLIs (Claude, Codex, Gemini, Aider, OpenCode)
4. Generate a pair code for mobile access

## Features

### Multi-Agent Teams

A **Team Leader** coordinates specialists to plan, implement, review,
and deliver — automatically. The built-in **Code Review loop** catches
bugs before you see them: Reviewer flags issues → Developer fixes →
re-review, up to 3 cycles until the code is clean.

### 150+ Specialist Roles

Ships with **[agency-agents](vendor/agency-agents)** — a curated library
of 150+ agent personas spanning engineering, design, product, marketing,
sales, game dev, spatial computing, and more. Assign the right expert
to every task, from Backend Architect to UX Researcher to Solidity
Auditor.

### Multi-Model Workflows

Run **Claude, Codex, Gemini, Aider, and OpenCode** together in one
pipeline, letting each model focus on what it does best.

### Pixel Office Workspace

Watch agents work in real time inside a **PixiJS pixel-art office**,
with live status, logs, and progress visualization.

### Instant Preview & Rating

Every completed task generates an **auto preview**. Rate the result
across five dimensions — your feedback becomes **persistent memory**
that shapes how agents approach the next project.

### Self-Improving Agents & Persistent Memory

Agents remember across sessions through a **four-layer memory system**
(`@bit-office/memory`):

| Layer | Scope | What it stores |
|-------|-------|----------------|
| **L0 — Ephemeral** | Current conversation | Sliding window (in-memory) |
| **L1 — Session** | Per-task | Structured summary: what/why/files/decisions/commits |
| **L2 — Agent** | Per-agent, long-term | Learned facts & preferences (up to 50, auto-deduped) |
| **L3 — Shared** | Cross-agent | Project-wide knowledge promoted from L2 |

After a session crash, agents recover with **structured context** (task
summary, changed files, commits, decisions) instead of raw chat
fragments. Facts are extracted rule-based (zero extra LLM cost) and
deduplicated via Jaccard similarity. High-confidence agent facts auto-
promote to shared project knowledge.

Review patterns, tech preferences, and project ratings also persist.
Agents **learn what you value** and adapt — low visual scores lead to
richer designs, recurring review failures get avoided automatically.

> Design details: [`packages/memory/MEMORY_REDESIGN.md`](packages/memory/MEMORY_REDESIGN.md)

### Token Cost Visibility

Track **token usage per agent and per team** in real time so you always
know the cost of each run.

### Live Sharing & Mobile Control

Invite others to watch progress, leave feedback, or manage sessions
directly from your phone.

### Cross-Device Sync

Real-time collaboration powered by **WebSocket, Ably, and Telegram
channels**.

### Project History

Every run is saved with a **replayable preview**, letting you revisit
results and build on previous work.

## Team Workflow

| Phase | What Happens | Your Action |
|---|---|---|
| **Create** | Team Lead gathers intent and scope | Describe what to build |
| **Design** | Team Lead proposes implementation plan | Approve or request changes |
| **Execute** | Developer builds → Reviewer audits → fix loop (up to 3 rounds) | Monitor or cancel |
| **Complete** | Preview and summary delivered | Rate, give feedback, or iterate |

Ratings persist as agent memory. The next project starts with lessons from the last one.

Full details in [team-workflow.md](team-workflow.md).

## Use Cases

- **AI-native prototyping** — go from idea to working preview in one session
- **Feature spikes** — rapid implementation with continuous preview feedback
- **Multi-model experiments** — compare how different AI backends approach the same task
- **Live demos** — show autonomous development workflows to your team or audience

## Run from Source

### Prerequisites

- **Node.js** 18+
- **pnpm**
- At least one AI CLI installed: `claude`, `codex`, `gemini`, `aider`, or `opencode`

### Setup

```bash
git clone https://github.com/longyangxi/open-office.git
cd open-office
pnpm install
pnpm dev
```

### Scripts

| Command | Description |
|---|---|
| `pnpm dev` | Web + gateway in dev mode |
| `pnpm dev:web` | Web only (Next.js) |
| `pnpm dev:gateway` | Gateway only |
| `pnpm dev:desktop` | Tauri desktop app (dev mode) |
| `pnpm build` | Build all packages |
| `pnpm build:desktop` | Build Tauri .app + .dmg |
| `pnpm start` | Build web and start gateway |

### Environment Variables

| Variable | Required | Description |
|---|---|---|
| `WORKSPACE` | No | Agent working directory |
| `ABLY_API_KEY` | No | Remote real-time channel |
| `TELEGRAM_BOT_TOKENS` | No | One token per bot/agent (comma-separated) |
| `WS_PORT` | No | Gateway WebSocket port (default: 9090) |
| `WEB_DIR` | No | Override served web build directory |

## Desktop App (Tauri)

Open Office also ships as a native **macOS desktop app** powered by [Tauri](https://tauri.app). The app bundles the gateway as a sidecar — no terminal, no browser, just launch and go.

### Prerequisites

- **Node.js** 18+, **pnpm**
- **Rust** toolchain — install via: `curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh`

### Dev Mode

```bash
pnpm dev:desktop
```

This starts the gateway (port 9099), web dev server, and Tauri window in one command.

### Build Release

```bash
pnpm build:desktop
```

Produces `Open Office.app` and `.dmg` at:
```
apps/desktop/src-tauri/target/release/bundle/macos/Open Office.app
apps/desktop/src-tauri/target/release/bundle/dmg/Open Office_0.1.0_aarch64.dmg
```

The release app:
- Auto-starts an embedded gateway (sidecar)
- Connects via local WebSocket (port 9090)
- Minimizes to system tray on close
- Reopens from Dock click

### Port Convention

| Mode | Gateway Port | Web |
|------|-------------|-----|
| `npx bit-office` | 9090 | Bundled at same port |
| `pnpm dev` | 9099 | localhost:3000 |
| `pnpm dev:desktop` | 9099 | Tauri window → localhost:3000 |
| Desktop app (release) | 9090 | Tauri window → static export |

## Architecture

```
open-office/
├── apps/
│   ├── web/            # Next.js PWA + PixiJS pixel office + control UI
│   ├── gateway/        # Runtime daemon: events, channels, policy, orchestration
│   └── desktop/        # Tauri v2 native shell (macOS .app/.dmg)
└── packages/
    ├── memory/         # Four-layer persistent memory (L0–L3)
    ├── orchestrator/   # Multi-agent execution engine
    └── shared/         # Typed command/event contracts (Zod schemas)
```

**Channels**: WebSocket (always on), Ably (optional), Telegram (optional)

## Tech Stack

- **Frontend**: Next.js 15, React, PixiJS v8, Zustand
- **Desktop**: Tauri v2 (Rust + system WebView)
- **Backend**: Node.js daemon, WebSocket
- **Memory**: Four-layer JSON store (session → agent → shared), Jaccard dedup
- **Protocol**: Zod-validated event schemas
- **Integrations**: Ably, Telegram, external process detection

## Contributing

Issues and PRs are welcome. If you're exploring AI-native dev tooling, workflows, or interfaces, Open Office is a great playground for experiments.

## Acknowledgments

Pixel office art inspired by [pixel-agents](https://github.com/pablodelucca/pixel-agents) by [@pablodelucca](https://github.com/pablodelucca).

## License

[MIT](LICENSE) - feel free to use, modify, and distribute.

---

<div align="center">

**If Open Office helps your workflow, consider giving it a star!**

</div>
