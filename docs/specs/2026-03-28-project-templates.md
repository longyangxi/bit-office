# Feature Spec: Project Templates

> Author: Nova (PM) | Date: 2026-03-28
> Assignee: **Mia** (Senior Dev)
> Effort: 1 day | Priority: P2 | Parent: Roadmap v2 §4.1

---

## Problem

Users stare at an empty project modal and don't know what to build. They must invent a task prompt from scratch, guess which agent roles to hire, and figure out the expected output structure. This friction kills activation — especially for new users who haven't yet seen what the system can do.

## Hypothesis

If we provide 5 pre-built templates that pre-fill task prompts and suggest team composition, new users will start their first project 2x faster.

## Success Metric

- **Primary**: Time from "New Project" click to task submission (target: < 30 seconds with template vs. current ~2 minutes)
- **Guardrail**: Template usage rate > 40% among first-time users

---

## Scope

### Must Have

1. **5 built-in templates**:

| Template | Description | Suggested Team | Example Prompt |
|----------|------------|----------------|----------------|
| Landing Page | Single-page marketing/portfolio site | 1 Developer + 1 Code Reviewer | "Build a portfolio landing page with hero section, 3 project cards, and contact form" |
| CLI Tool | Command-line utility with argument parsing | 1 Developer + 1 Code Reviewer | "Build a CLI tool that converts CSV files to JSON with --input and --output flags" |
| REST API | Express/Fastify API with CRUD endpoints | 1 Developer + 1 Code Reviewer | "Build a REST API with /users CRUD endpoints, input validation, and error handling" |
| Chrome Extension | Browser extension with popup UI | 1 Developer + 1 Code Reviewer | "Build a Chrome extension that shows word count and reading time for any webpage" |
| Static Blog | Markdown-based static site | 1 Developer | "Build a static blog with 3 sample posts, tag filtering, and dark mode toggle" |

2. **Template selector UI**: Grid of template cards shown in:
   - Empty state (no active project) — prominent placement
   - NewProjectModal — as a step before/alongside directory selection

3. **"Use Template" action**: Pre-fills:
   - Project name (editable, from template)
   - Task prompt in the agent input field
   - Suggested mode (solo vs. team) based on template's team config

4. **"Blank Project" option**: Always available alongside templates (current behavior = blank)

### Won't Have

- User-created/custom templates (v2)
- Template marketplace or community sharing
- Template preview screenshots
- Template-specific project scaffolding (no file generation — the AI agent does the actual work)

---

## Technical Design

### File Structure

```
apps/web/src/templates/
  templates.ts              # Template definitions (data only)
  TemplateCard.tsx           # Single template card component
  TemplateSelector.tsx       # Grid of template cards
```

### Data Model

```typescript
// templates.ts
export interface ProjectTemplate {
  id: string;                    // e.g. "landing-page"
  name: string;                  // e.g. "Landing Page"
  description: string;           // One-line description
  icon: string;                  // Lucide icon name (e.g. "globe", "terminal")
  suggestedPrompt: string;       // Pre-fill for task input
  suggestedMode: "solo" | "team"; // Default project mode
  suggestedRoles: string[];      // e.g. ["Developer", "Code Reviewer"]
  tags: string[];                // For future filtering: ["frontend", "beginner"]
}

export const BUILT_IN_TEMPLATES: ProjectTemplate[] = [
  // ... 5 templates defined here
];
```

### Integration Points

1. **NewProjectModal.tsx** (`apps/web/src/components/office/ui/NewProjectModal.tsx`):
   - Add a "Choose a template" step before the current name/directory form
   - If template selected → pre-fill project name, store selected template in local state
   - Pass `selectedTemplate` to the parent via `onCreated(projectId, mode, template?)`

2. **Empty state** (wherever the "no active project" UI is shown):
   - Render `<TemplateSelector />` as the primary CTA
   - Clicking a template opens NewProjectModal with that template pre-selected

3. **Task input pre-fill**:
   - After project creation, if a template was selected, the task input field in AgentPane should show the template's `suggestedPrompt` as a pre-filled value (editable, not placeholder)
   - Use office-store: add `pendingTemplatePrompt?: string` field, consumed once by AgentPane

### UI Design

**TemplateCard layout** (terminal aesthetic, consistent with existing UI):
```
┌──────────────────────────┐
│  🌐  Landing Page        │
│                          │
│  Single-page marketing   │
│  or portfolio site       │
│                          │
│  Team: Dev + Reviewer    │
│  [Use Template]          │
└──────────────────────────┘
```

- Cards use existing `TermButton`, border/bg styles from `global.css`
- Grid: 2-3 columns responsive (use CSS grid or flex)
- Hover state: border highlight with `--color-primary`

---

## Acceptance Criteria

1. **Given** a user opens NewProjectModal, **when** they see the template selector, **then** 5 template cards are displayed in a grid plus a "Blank Project" option
2. **Given** a user clicks "Use Template" on "Landing Page", **when** the project is created, **then** the project name is pre-filled as "Landing Page" and the task input shows the suggested prompt
3. **Given** a user has no active project (empty state), **when** they see the main UI, **then** the template selector is visible as the primary action
4. **Given** a user selects a template with `suggestedMode: "team"`, **when** the project is created, **then** the mode defaults to "team" (but is still changeable)
5. **Given** a user clicks "Blank Project", **when** the modal proceeds, **then** behavior is identical to the current flow (no pre-fill)

---

## Open Questions

1. Should template selection persist (show "Built from Landing Page template" in project history)?
   → **Decision: No for v1.** Keep it simple — template is a creation-time convenience only.

2. Should we show templates in a separate tab or inline in the modal?
   → **Decision: Inline** — templates as the first view in NewProjectModal, with "or start blank" link below.
