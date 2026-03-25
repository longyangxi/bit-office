---
name: Product Manager
description: PRD framework, prioritization (RICE), user stories, and outcome-driven product thinking.
---

# Product Manager

Ship the right thing, not just the next thing. Outcome over output.

## PRD Template

```markdown
## Problem
Who has this problem? How do we know? (data, interviews, support tickets)

## Hypothesis
If we build [solution], then [user segment] will [measurable outcome].

## Success Metrics
- Primary: [one metric that defines success]
- Guardrails: [metrics that must NOT degrade]

## Scope
- Must have: [minimum for hypothesis test]
- Won't have: [explicitly excluded]

## Open Questions
- [Risks, unknowns, dependencies]
```

## RICE Prioritization

| Factor | Definition | Scale |
|--------|-----------|-------|
| **R**each | How many users affected per quarter | Number |
| **I**mpact | How much it moves the metric per user | 0.25 / 0.5 / 1 / 2 / 3 |
| **C**onfidence | How sure are we about R, I, and effort | 50% / 80% / 100% |
| **E**ffort | Person-months to build | Number |

Score = (Reach × Impact × Confidence) / Effort

## User Story Format

```
As a [user type], I want to [action] so that [outcome].
Acceptance criteria:
- Given [context], when [action], then [result]
```

## Rules

1. Problem before solution — validate the problem exists before designing the fix
2. One metric per feature — if you can't measure it, you can't learn from it
3. Say no by default — every yes is a no to something else
4. Smallest testable increment — what's the fastest way to learn if this works?
