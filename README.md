# Bit Office

Gameified command center for AI coding agents.

Bit Office turns invisible AI automation into a live, controllable workspace: you can run multiple AI CLIs, watch execution in a pixel office, approve risky actions, and inspect results from desktop or phone.

<video src="https://github.com/user-attachments/assets/a13ac1a0-8440-49f1-ab1e-110a35847d0c" controls width="100%"></video>

## Why It Stands Out

- Visual operations for AI coding: see status, logs, and approvals in one place
- Multi-model runtime: connect different agent CLIs in the same project
- Human-in-the-loop safety: approval gates for risky commands
- Ship-first feedback loop: auto preview generation for completed tasks
- 12 office visual styles: switch workspace themes to match your project mood
- Built-in project history: every completed run is saved with replayable preview
- Cost visibility by design: token usage tracked per agent and per team
- Shareable live office: invite others to watch progress and suggest improvements in real time
- Mobile-first control: pair your phone and manage sessions anywhere
- Real-world integrations: WebSocket, Ably, Telegram, external process detection

## 30-Second Quick Start

```bash
npx bit-office
```

What you get:

- Local gateway starts
- Browser UI opens
- Installed AI CLIs are detected
- Pair code is generated for phone access

## What You Can Build With It

- AI-native product prototyping
- Rapid feature spikes with continuous preview
- Multi-agent coding experiments across different model backends
- Live demos of autonomous development workflows

## Feature Highlights

- Agent orchestration engine (`@bit-office/orchestrator`)
- Pixel-art real-time office UI (Next.js + React + Zustand)
- 12 selectable office skins for different visual themes
- Event-safe protocol layer (`@office/shared`)
- Preview resolution for static output, build artifacts, and running services
- Project history timeline with preview links for completed deliveries
- Token analytics dashboard across agent-level and team-level execution
- Live office sharing with viewer feedback that agents can incorporate into next iterations
- External agent process scanning + live output streaming
- Cross-device session pairing and remote control channels

## Team Workflow

All team-specific details (roles, phases, loops, reviewer cycles, lead behavior, preset roles) are documented in:

- [team-workflow.md](team-workflow.md)

## Run From Source

### Prerequisites

- Node.js 18+
- pnpm
- At least one supported AI CLI installed locally (`claude`, `codex`, `gemini`, `aider`, or `opencode`)

### Install and run

```bash
git clone https://github.com/longyangxi/bit-office.git
cd bit-office
pnpm install
pnpm dev
```

### Useful scripts

```bash
pnpm dev          # web + gateway in dev mode
pnpm dev:web      # web only (Next.js)
pnpm dev:gateway  # gateway only
pnpm build        # build all packages
pnpm start        # build web and start gateway
```

### Environment variables

```bash
WORKSPACE=/path/to/project       # optional; agent working directory
ABLY_API_KEY=your-ably-key       # optional; remote realtime channel
TELEGRAM_BOT_TOKENS=t1,t2,t3     # optional; one token per bot/agent
WEB_DIR=/custom/web/out          # optional; override served web build dir
```

## Architecture

```text
apps/
  web/           Next.js PWA + pixel office renderer + control UI
  gateway/       runtime daemon (events, channels, policy, orchestration)

packages/
  orchestrator/  multi-agent execution engine
  shared/        typed command/event contracts
```

## Inspiration

Pixel office art inspired by [pixel-agents](https://github.com/pablodelucca/pixel-agents) by [@pablodelucca](https://github.com/pablodelucca).

## Contributing

Issues and PRs are welcome.

If you are exploring AI-native dev tooling, workflows, or interfaces, Bit Office is a good playground for experiments.

## License

MIT
