<div align="center">

# Open Office

### A visible workspace for AI agents to collaborate as a single team.

[![npm version](https://img.shields.io/npm/v/open-office?color=cb3837&logo=npm)](https://www.npmjs.com/package/open-office)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![Node.js](https://img.shields.io/badge/Node.js-18+-339933?logo=node.js&logoColor=white)](https://nodejs.org/)
[![PRs Welcome](https://img.shields.io/badge/PRs-welcome-brightgreen.svg)](https://github.com/longyangxi/open-office/pulls)

**Supports Claude, Codex, Gemini, Copilot, Cursor, Aider, OpenCode, Pi & Sapling — one team 🚀**


[Quick Start](#quick-start) | [Features](#features) | [Architecture](#architecture) | [Contributing](#contributing)

</div>

---
![Image](https://github.com/user-attachments/assets/ecfcd88b-e72e-4b04-bdd7-87eea9f00b51)


## Features
- **8 AI backends, 150+ roles** — Claude, Codex, Gemini, Copilot, and more in one pipeline  
- **Team-based delivery** — Leader coordinates planning, coding, review, and release  
- **Parallel collaboration** — Worktree isolation with auto commit, merge, and undo  
- **Flexible code review** — Mix Claude Code, Codex, or any tool you prefer  
- **Preview & feedback** — Live preview, rating, and continuous learning  
- **Persistent memory** — 4-layer memory across sessions and agents  
- **Telegram Control** — Manage your agent team remotely  
- **Native desktop app** — Tauri-based app with system notifications  
- **Token cost tracking** — Real-time usage per agent and team  

## Quick Start

```bash
npx bit-office
```

## Learn More

- **150+ specialist roles** powered by [agency-agents](vendor/agency-agents)  
- **Team workflow** — how agents plan, execute, and deliver ([view](team-workflow.md))  
- **Collaboration system** — multi-agent orchestration and worktree isolation ([view](packages/orchestrator/README.md))  
- **Memory design** — four-layer persistent memory architecture ([view](packages/memory/README.md))  

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
