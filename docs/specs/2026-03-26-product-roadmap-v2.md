# Open Office Product Roadmap v2

> Author: Nova (PM) | Date: 2026-03-26
> Status: Approved for implementation
> Priority: P0 → P1 → P2 (top-down)

---

## Executive Summary

Open Office's unique moat is **"AI team working in a visible office"**. This roadmap focuses on three goals:

1. **Lower the entry barrier** — let new users experience the magic in under 3 minutes
2. **Strengthen emotional connection** — make agents feel like "your team", not "your tools"
3. **Enable viral growth** — give users something worth sharing

---

## Phase 1: Zero-Friction Onboarding (P0)

### 1.1 Demo Mode — "See the magic before installing"

**Problem**: Current onboarding requires installing gateway + configuring backend + understanding worktree/memory concepts. Most users drop off before seeing value.

**Hypothesis**: If we provide a zero-install demo mode, new user activation rate will increase by 3x.

**Success Metric**: % of first-time visitors who reach "Aha moment" (see agents complete a task) within 3 minutes.

**Scope**:

Must have:
- Web-only mode (no gateway required) with simulated agent activity
- 2 pre-configured demo agents (a Developer + a Code Reviewer) with visible pixel characters
- Simulated task flow: user types a task → agents "work" (animated typing, walking, chat messages) → show mock result (diff, file list, review comments)
- Demo data is pre-recorded event sequences, replayed with realistic timing
- Clear "Install for real" CTA after demo completes
- Banner/badge indicating "Demo Mode" so users don't confuse with real output

Won't have:
- Real AI backend calls in demo mode
- Editable agent config in demo mode
- Team mode (keep it to 2 agents max)

**Implementation Notes**:
```
apps/web/src/demo/
  demo-events.json          # Pre-recorded event sequence (TASK_STARTED → messages → TASK_DONE)
  demo-provider.ts          # Replays events into office-store at realistic intervals
  useDemoMode.ts            # Hook: detects no gateway connection → offers demo mode
```
- Reuse existing `handleEvent()` in office-store — demo just feeds it synthetic events
- Character animations, chat, pane updates all work automatically since they consume the same store
- Add `?demo=1` URL param to force demo mode (useful for sharing)

**Acceptance Criteria**:
- Given a user opens the web app with no gateway running, when they click "Try Demo", then 2 agents appear in the pixel office and begin a simulated task within 5 seconds
- Given the demo is playing, when agents "complete" the task, then a result panel shows mock diff stats and a "Install to use with real AI" CTA
- Given demo mode is active, when user connects a real gateway, then demo mode exits automatically

---

### 1.2 First Team Project — Guided Tutorial

**Problem**: After installation, users see an empty office and don't know what to do first.

**Hypothesis**: If we provide a guided first project, 7-day retention will increase by 50%.

**Success Metric**: % of new installs that complete the guided project within first session.

**Scope**:

Must have:
- "Start your first project" button prominent in empty state (both pixel office and console mode)
- Pre-set project template: "Build a portfolio landing page" (simple, visual, fast)
- Step-by-step overlay hints (not a full tutorial — just 4-5 contextual tooltips):
  1. "Click here to hire your first agent" → Hire modal opens with Developer pre-selected
  2. "Now hire a reviewer" → Hire modal with Code Reviewer pre-selected
  3. "Type your task here" → Task input focused with placeholder "Build a portfolio page with my name and 3 project cards"
  4. "Watch your team work!" → Highlight the agent cards/pixel office
  5. "Your project is done!" → Show result + preview + celebration
- Skip button on every step

Won't have:
- Forced linear flow — user can skip and do their own thing
- Complex project templates (just this one for now)
- Video tutorials

**Implementation Notes**:
```
apps/web/src/onboarding/
  OnboardingOverlay.tsx     # Tooltip overlay component (positioned near target element)
  onboarding-store.ts       # Zustand slice: currentStep, completed, skipped
  steps.ts                  # Step definitions: target element selector, text, action
```
- Persist `onboardingCompleted` in localStorage — never show again after completion or skip-all
- Each step targets an existing UI element (hire button, task input, etc.) — no new UI needed
- Celebration at end uses existing `CelebrationModal` + `ConfettiOverlay`

**Acceptance Criteria**:
- Given a new user with no agents, when they open the app, then "Start your first project" is visible in the empty state area
- Given onboarding is active, when user completes each step, then the next tooltip appears near the relevant UI element
- Given onboarding is active, when user clicks "Skip", then all tooltips disappear and `onboardingCompleted` is set

---

## Phase 2: Agent Personality & Emotional Connection (P1)

### 2.1 Agent Work Styles

**Problem**: All agents feel identical. Users have no reason to prefer one over another or form attachment.

**Hypothesis**: If agents have visible personality traits, users will name/keep agents longer (proxy for retention).

**Success Metric**: Average agent lifespan (time from hire to fire) increases by 2x.

**Scope**:

Must have:
- 4 work style archetypes:
  - **Speedy** — faster typing animation, shorter messages, occasionally skips details
  - **Thorough** — slower animation, longer messages, more review comments
  - **Creative** — varied idle animations, occasionally suggests alternatives in chat
  - **Steady** — consistent pace, predictable output, minimal surprises
- Work style shown as a badge on agent card (e.g., ⚡ Speedy, 🔍 Thorough, 💡 Creative, 🪨 Steady)
- Work style affects ONLY visual presentation (animation speed, message style, idle behavior) — NOT actual AI behavior or prompts
- Auto-assigned on hire (random or user-selected)

Won't have:
- Work style affecting actual AI prompts or output quality
- User-editable personality sliders
- More than 4 archetypes in v1

**Implementation Notes**:
```
packages/shared/src/agent-personality.ts    # WorkStyle type + traits config
apps/web/src/components/office/
  character-style.ts                        # Animation speed/idle multipliers per style
  AgentBadge.tsx                            # Style badge component
```
- Each style is a config object: `{ typeSpeed: 1.5, idleVariance: 'high', messageLength: 'short' }`
- Character animation system already supports speed multipliers — just parameterize
- Message display in chat can add style-appropriate prefixes or formatting

**Acceptance Criteria**:
- Given an agent with "Speedy" style, when it's typing in the pixel office, then the typing animation is visibly faster than a "Thorough" agent
- Given an agent card, when I look at it, then I can see the work style badge
- Given agent hire flow, when creating a new agent, then a work style is assigned (random default, optional manual pick)

---

### 2.2 Task Completion Celebrations

**Problem**: Task completion feels anticlimactic. Users don't get emotional reward for waiting.

**Hypothesis**: If we add satisfying completion moments, users will assign more tasks (engagement proxy).

**Success Metric**: Average tasks per session increases by 30%.

**Scope**:

Must have:
- Agent character does a small celebration animation on TASK_DONE (fist pump, jump, spin — 1-2 seconds)
- Confetti particle effect (already exists via ConfettiOverlay — extend to trigger on individual task completion, not just project completion)
- Sound effect (optional, off by default — respect user preference)
- Result summary card with:
  - Files changed count + lines added/removed
  - Time taken
  - Review rounds (if team mode)
  - "Well done, [AgentName]!" message

Won't have:
- Different celebrations per work style (v2)
- Leaderboard or competitive elements
- Celebrations for failed tasks

**Implementation Notes**:
- Extend existing `ConfettiOverlay` to accept `intensity` param (small burst for task, big burst for project)
- Add 3-frame celebration sprite to character sprite sheet (reuse walk frames with Y offset)
- Result card is a variant of existing TASK_DONE event display in AgentPane

---

## Phase 3: Viral Growth & Shareability (P1)

### 3.1 Project Result Cards

**Problem**: Users have no way to show others what their AI team built. No natural sharing moment.

**Hypothesis**: If we generate shareable result cards, we'll see organic social sharing (Twitter/Discord).

**Success Metric**: Number of result card screenshots shared externally (tracked via optional share button click).

**Scope**:

Must have:
- On project completion, generate a visual "result card" (HTML → canvas → PNG):
  ```
  ┌─────────────────────────────────┐
  │  🏢 Open Office                 │
  │                                 │
  │  Project: Portfolio Landing Page│
  │  ────────────────────────────── │
  │  Team: Mia (Dev) + Leo (Review) │
  │  Time: 12 min                   │
  │  Files: 8 changed (+340 -12)   │
  │  Reviews: 2 rounds → PASS      │
  │  Tokens: 45K total             │
  │                                 │
  │  ⚡ Built by AI, managed by you │
  └─────────────────────────────────┘
  ```
- "Copy to clipboard" button (PNG)
- "Share" button opens OS share sheet (Web Share API) or copies link
- Card rendered client-side (no server needed)

Won't have:
- Cloud-hosted shareable links (privacy concern)
- Preview screenshot of the actual project output
- Integration with specific social platforms

**Implementation Notes**:
```
apps/web/src/components/share/
  ResultCard.tsx              # React component for the card layout
  useResultCardCapture.ts     # html2canvas or similar to generate PNG
  ShareButton.tsx             # Triggers capture + Web Share API
```
- Trigger: show share option in CelebrationModal after project COMPLETE
- Use `html2canvas` (or `dom-to-image-more`) for PNG generation — lightweight, no server

---

### 3.2 Team Productivity Dashboard

**Problem**: Users can't see long-term value. Each session feels isolated.

**Hypothesis**: If users can see cumulative team output, perceived value increases and churn decreases.

**Success Metric**: 30-day retention rate.

**Scope**:

Must have:
- Dashboard page (`/dashboard` or modal) showing:
  - Total projects completed (all time)
  - Total files changed / lines written
  - Total tokens spent
  - Agent roster with per-agent stats (tasks completed, avg review score)
  - Weekly activity heatmap (GitHub contribution-graph style, 7 columns × N weeks)
- Data sourced from existing `project-history/*.json` files

Won't have:
- Real-time updating (refresh on open is fine)
- Export to CSV
- Comparison across multiple offices

**Implementation Notes**:
```
apps/web/src/components/dashboard/
  Dashboard.tsx               # Main dashboard layout
  ActivityHeatmap.tsx          # SVG-based contribution graph
  AgentStats.tsx              # Per-agent stat cards
  useDashboardData.ts         # Aggregates from project-history API
```
- Gateway exposes `/api/stats` endpoint aggregating project-history JSON files
- Heatmap: simple SVG grid, 5 intensity levels (0-4 tasks/day), green palette matching terminal theme

---

## Phase 4: Quality of Life (P2)

### 4.1 Project Templates

**Scope**:
- 5 built-in templates: Landing Page, CLI Tool, REST API, Chrome Extension, Static Blog
- Each template defines: description, suggested team (roles), example task prompt, expected output structure
- "Use template" pre-fills task input + suggests agent roles in hire flow

```
apps/web/src/templates/
  templates.ts                # Template definitions
  TemplateSelector.tsx        # Grid of template cards in empty state / new project flow
```

### 4.2 Memory Dashboard

**Scope**:
- View L1 (session) and L2 (agent facts) in a dedicated panel
- Edit/delete individual facts
- See L3 (shared) facts with source attribution
- Read-only — no bulk operations in v1

### 4.3 Performance Guard for Pixel Office

**Scope**:
- Add FPS counter (debug mode)
- Viewport culling: only render characters/furniture visible in viewport
- Cap at 12 agents rendered simultaneously; show overflow as count badge
- Benchmark: maintain 30fps with 8 agents on M1 MacBook Air

---

## Implementation Order & Estimates

| # | Feature | Effort | Dependencies | Assignable To |
|---|---------|--------|-------------|---------------|
| 1 | Demo Mode (1.1) | 3-4 days | None | Senior Dev (Mia) |
| 2 | First Project Guide (1.2) | 2 days | None (parallel with #1) | UI Designer (Leo) |
| 3 | Task Celebrations (2.2) | 1 day | None | Any Dev |
| 4 | Result Cards (3.1) | 2 days | None | Any Dev |
| 5 | Agent Work Styles (2.1) | 2-3 days | Sprite work needed | Dev + Designer |
| 6 | Dashboard (3.2) | 3 days | Gateway API endpoint | Senior Dev |
| 7 | Project Templates (4.1) | 1 day | Onboarding flow helps | Any Dev |
| 8 | Memory Dashboard (4.2) | 2 days | Gateway API endpoint | Any Dev |
| 9 | Perf Guard (4.3) | 2 days | None | Senior Dev |

**Total estimated: ~18-20 dev-days** (can parallelize to ~10 calendar days with 2 devs)

---

## Open Questions

1. **Demo mode hosting** — Should demo mode work on a public URL (e.g., `demo.open-office.dev`) or only in locally-served web app?
2. **Sound effects** — Do we want ambient office sounds (typing, coffee) or just task-complete chimes? Need audio assets.
3. **Agent identity persistence** — If a user fires and re-hires an agent with the same name, should it retain memories? (Currently: no — new agent = clean slate)
4. **Template contributions** — Should templates be user-submittable? (Not in v1, but design for extensibility)
5. **Analytics** — Do we want anonymous usage analytics to validate these hypotheses? If yes, what's the privacy stance?

---

## Success Criteria (90-day)

| Metric | Current (est.) | Target |
|--------|---------------|--------|
| First-session "Aha" rate | ~20% | 60% |
| Avg tasks per session | ~2 | 5 |
| 7-day retention | Unknown | 40% |
| Social shares per week | ~0 | 10+ |
| Avg agent lifespan | ~1 session | 3+ sessions |

---

*This document is ready for agent execution. Each section is self-contained and can be assigned as an independent task.*
