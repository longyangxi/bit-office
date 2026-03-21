<div align="center">

# Open Office

### Your AI agents deserve an office.

[![npm version](https://img.shields.io/npm/v/open-office?color=cb3837&logo=npm)](https://www.npmjs.com/package/open-office)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![PRs Welcome](https://img.shields.io/badge/PRs-welcome-brightgreen.svg)](https://github.com/longyangxi/open-office/pulls)

**Claude · Codex · Gemini · Copilot · Cursor · Aider · OpenCode · Pi · Sapling**
**One team. One office.**

[Quick Start](#quick-start) · [How It Works](#how-it-works) · [Backends](#supported-backends) · [Contributing](#contributing)

</div>

---

![Image](https://github.com/user-attachments/assets/ecfcd88b-e72e-4b04-bdd7-87eea9f00b51)

## Why Open Office

AI agents today run blind — no coordination, no visibility, no memory. Open Office changes that.

Put multiple AI models in **one pixel-art office** where they plan, code, review, and ship as a team. Watch them work. Rate the results. They remember your feedback and **get better next time**.

## Quick Start

```bash
npx bit-office
```

Opens a pixel office in your browser. Auto-detects your installed AI CLIs. That's it.

## How It Works

**Describe → Approve → Ship → Rate**

1. Tell the Team Leader what to build
2. Review the proposed plan
3. Watch agents execute — with built-in code review loops (up to 3 rounds)
4. Rate the result across 5 dimensions — your scores become persistent memory

> Agents learn what you value. Low visual scores → richer designs next time. Recurring bugs → proactively avoided.

## Key Features

🏢 **Pixel Office UI** — Real-time visualization of every agent's status, logs, and progress

🤝 **Multi-Agent Coordination** — Team Leader orchestrates 150+ specialist roles across planning, coding, and review

🧠 **Persistent Memory** — Agents remember decisions, preferences, and your ratings across sessions

🔌 **9 AI Backends** — Mix models in one pipeline; each focuses on what it does best

📱 **Mobile & Sharing** — Pair code for phone access; invite others to watch or give feedback

💰 **Token Tracking** — Real-time cost visibility per agent and per team

📦 **Instant Preview** — Every task produces a live preview you can rate immediately

🖥️ **Desktop App** — Native macOS app via Tauri — no terminal needed

## Supported Backends

Auto-detected at startup. Just have the CLI installed.

| Backend | CLI | Status |
|---|---|---|
| Claude Code | `claude` | ✅ Stable |
| Codex CLI | `codex` | ✅ Stable |
| Gemini CLI | `gemini` | Beta |
| GitHub Copilot | `copilot` | Experimental |
| Cursor | `agent` | Experimental |
| Aider | `aider` | Experimental |
| OpenCode | `opencode` | Experimental |
| Pi | `pi` | Experimental |
| Sapling | `sp` | Experimental |

## Run from Source

```bash
git clone https://github.com/longyangxi/open-office.git
cd open-office
pnpm install
pnpm dev
```

Requires Node.js 18+ and at least one AI CLI above.

See [CONTRIBUTING.md](CONTRIBUTING.md) for scripts, env vars, desktop builds, and architecture details.

## Architecture

```
apps/web/        → Next.js + PixiJS pixel office UI
apps/gateway/    → Runtime daemon (orchestration, events, channels)
apps/desktop/    → Tauri v2 native macOS app
packages/memory/ → Persistent memory (session → agent → shared)
```

## Contributing

Issues and PRs welcome. If you're building with AI agents, this is a great playground.

## Acknowledgments

Pixel art inspired by [pixel-agents](https://github.com/pablodelucca/pixel-agents) by [@pablodelucca](https://github.com/pablodelucca).

## License

[MIT](LICENSE)

---

<div align="center">

**⭐ Star if Open Office helps your workflow**

</div>
