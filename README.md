# Bit Office

Your very own AI dev shop — a pixel-art office staffed with AI coders who actually write code.

Assign tasks, sit back, sip your coffee, and watch your AI employees grind away like it's crunch week. Every. Single. Day.

## Features

- **Pixel Office UI** — PixiJS-rendered 2D office, each AI agent is a pixel character with idle/working/approval animations
- **Multi-Agent Orchestration** — Team lead delegates tasks to workers, collects results, retries on failure, escalates when stuck
- **Multi-Channel** — WebSocket (LAN), Ably (remote), Telegram (bot per agent)
- **Multi-Backend** — Claude Code, Codex, Gemini CLI, Aider, OpenCode — use whatever's installed
- **Mobile PWA** — Install on phone, pair with a 6-digit code, control agents anywhere
- **Approval Bubbles** — Risky commands (git push, rm -rf, npm install) trigger Yes/No approval on your phone
- **Office Editor** — Drag-and-drop furniture, paint floors/walls, customize your virtual office

## Quick Start

```bash
npx bit-office
```

That's it. Opens a browser UI, auto-detects installed AI backends, generates a pair code for your phone.

## Demo

https://github.com/user-attachments/assets/demo.mp4

## Run from Source

### Prerequisites

- Node.js 18+
- pnpm
- At least one AI CLI installed: `claude`, `codex`, `gemini`, `aider`, or `opencode`

### Setup

```bash
git clone https://github.com/anthropics/bit-office.git
cd bit-office
pnpm install

# Configure workspace (where agents will work)
cp apps/gateway/.env.example apps/gateway/.env
# Edit .env — set WORKSPACE to your target project directory
```

### Development

```bash
# Start both web + gateway
pnpm dev

# Or separately
pnpm dev:web       # Next.js on :3000
pnpm dev:gateway   # Gateway on :9090
```

### Environment Variables

```bash
# Required for dev (defaults to .workspace/ dir if unset)
WORKSPACE=/path/to/your/project

# Optional: enable remote access via Ably
ABLY_API_KEY=your-ably-key

# Optional: Telegram bots (position maps to agent preset)
TELEGRAM_BOT_TOKENS=token_alex,token_mia,,token_sophie,,token_marcus
```

### Build & Publish

```bash
pnpm build:release    # Build web + gateway
pnpm publish:release  # Publish to npm
```

## Architecture

```
Phone (PWA)                          Mac (Daemon)
┌─────────────┐    WebSocket/Ably    ┌──────────────────────────┐
│  Next.js 15 │ ◄─────────────────► │  Gateway                 │
│  PixiJS v8  │    pair code auth    │  ├─ Orchestrator         │
│  Zustand    │                      │  │  ├─ Agent Sessions    │
│  PWA        │   commands ──────►   │  │  ├─ Delegation Router │
│             │   ◄────── events     │  │  ├─ Retry Tracker     │
└─────────────┘                      │  │  └─ Prompt Engine     │
                                     │  ├─ Channels             │
                                     │  │  ├─ WebSocket (LAN)   │
                                     │  │  ├─ Ably (Remote)     │
                                     │  │  └─ Telegram (Bots)   │
                                     │  └─ Policy Engine        │
                                     └──────────┬───────────────┘
                                                │ spawn
                                     ┌──────────▼───────────────┐
                                     │  AI CLI Processes         │
                                     │  claude / codex / gemini  │
                                     └──────────────────────────┘
```

### Project Structure

```
apps/
  web/           Next.js 15 PWA — pixel office UI, pairing, agent control
  gateway/       Node.js daemon — channels, orchestration, AI process management

packages/
  shared/        Zod schemas — type-safe command/event protocol
  orchestrator/  Multi-agent engine — delegation, retry, prompt templates
```

### Event Flow

The UI only renders 4 key events to keep things simple:

| Event | Agent State | UI |
|-------|-------------|-----|
| `TASK_STARTED` | working | Character animates |
| `APPROVAL_NEEDED` | waiting_approval | Speech bubble (Yes/No) |
| `TASK_DONE` | done | Summary popup |
| `TASK_FAILED` | error | Error indicator |

### Team Delegation

```
User assigns task to Team Lead
  └─ Lead delegates to workers (@Alex, @Mia, ...)
       └─ Workers execute in parallel
            └─ Results collected (20s batch window)
                 └─ Lead reviews → DONE or one retry round
```

Safeguards: max 5 delegation depth, max 20 total delegations, budget of 5 rounds.

## Agent Presets

| Name | Role | Style |
|------|------|-------|
| Alex | Frontend Dev | Friendly, casual |
| Mia | Backend Dev | Formal, professional |
| Leo | Fullstack Dev | Aggressive, action-first |
| Sophie | Code Reviewer | Patient, mentor-like |
| Yuki | QA / Tester | Concise, no fluff |
| Marcus | Architect | Formal, strategic |

## License

MIT
