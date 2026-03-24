<div align="center">

# Open Office

### A pixel-art workspace for AI agents and multi-agent collaboration

[![npm version](https://img.shields.io/npm/v/open-office?color=cb3837&logo=npm)](https://www.npmjs.com/package/open-office)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![Node.js](https://img.shields.io/badge/Node.js-18+-339933?logo=node.js&logoColor=white)](https://nodejs.org/)
[![PRs Welcome](https://img.shields.io/badge/PRs-welcome-brightgreen.svg)](https://github.com/longyangxi/open-office/pulls)

**Supports Claude, Codex, Gemini, Copilot, Cursor, Aider, OpenCode, Pi & Sapling — one team 🚀**


[Quick Start](#quick-start) | [Features](#features) | [Team Workflow](#team-workflow) | [Architecture](#architecture) | [Contributing](#contributing)

</div>

---
![Image](https://github.com/user-attachments/assets/ecfcd88b-e72e-4b04-bdd7-87eea9f00b51)

## What is Open Office

Open Office gives AI automation a visible, controllable workspace. Multiple AI models collaborate as a single team — planning, coding, reviewing, and delivering in one continuous flow.

## Quick Start

```bash
npx bit-office
```

## Features

### Multi Models & 150+ Roles
8 AI CLI backends in one pipeline (see [Supported Backends](#supported-backends)).  
150+ specialist roles powered by [agency-agents](vendor/agency-agents).

### Team Delivery
A team leader coordinates specialists to plan, implement, review, and deliver (see [Team Workflow](team-workflow.md)).

### Collaboration
Multiple agents work together with worktree isolation. Auto commit, merge, and manual undo.([`Collaboration`](packages/orchestrator/README.md))

### Code Review
Write code with Claude Code, review it with Codex — or use any combination you prefer.

### Preview & Rating
Every delivery generates a live preview. Rate it, provide feedback, and agents learn from it.

### Persistent Memory
Agents remember across sessions through a four-layer memory system([`Memory Design`](packages/memory/README.md)).

### Telegram Bot
Use a Telegram bot to control your entire agent team.

### Desktop App 
Native desktop app powered by Tauri with system notifications.

### Token Cost Visibility
Track token usage per agent and per team in real time.

## Run from Source

### Prerequisites

- **Node.js** 18+
- **pnpm**
- At least one AI CLI installed (see [Supported Backends](#supported-backends))

### Setup

```bash
git clone https://github.com/longyangxi/open-office.git
cd open-office
pnpm install
pnpm dev
```

## Desktop App (Tauri)

Open Office also ships as a native **macOS desktop app** powered by [Tauri](https://tauri.app). 

### Prerequisites

- **Node.js** 18+, **pnpm**
- **Rust** toolchain — install via: `curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh`

### Dev Mode

```bash
pnpm dev:desktop
```


### Build Release

```bash
pnpm build:desktop
```

Produces `Open Office.app` and `.dmg` at:
```
apps/desktop/src-tauri/target/release/bundle/macos/Open Office.app
apps/desktop/src-tauri/target/release/bundle/dmg/Open Office_0.1.0_aarch64.dmg
```

## Supported Backends

Open Office auto-detects installed AI CLIs at startup. Each backend has its own instruction file convention and capability set.

| Backend | Command | Stability | Guard | Instruction File | Resume | Structured Output | Tested |
|---|---|---|---|---|---|---|---|
| **Claude Code** | `claude` | Stable | Hooks | `.claude/CLAUDE.md` | Yes | Yes (stream-json) | ✅ |
| **Codex CLI** | `codex` | Stable | Sandbox (Seatbelt/Landlock) | `AGENTS.md` | — | — | ✅ |
| **Gemini CLI** | `gemini` | Beta | `--sandbox` flag | `GEMINI.md` | — | — | — |
| **GitHub Copilot** | `copilot` | Experimental | — | `.github/copilot-instructions.md` | — | — | — |
| **Cursor CLI** | `agent` | Experimental | — | `.cursor/rules/instructions.md` | — | — | — |
| **Aider** | `aider` | Experimental | — | `.aider.conf.yml` | — | — | — |
| **OpenCode** | `opencode` | Experimental | — | `AGENTS.md` | — | Yes (json) | — |
| **Pi** | `pi` | Experimental | — | `.claude/CLAUDE.md` | — | — | — |
| **Sapling** | `sp` | Experimental | — | `SAPLING.md` | — | Yes (json) | — |

> ✅ = actively tested in production workflows. Other backends have not yet verified end-to-end.
>
> Backends with ambiguous binary names (`agent`, `pi`, `sp`) use version-probe detection to avoid false positives.

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
