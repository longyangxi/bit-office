---
name: Technical Writer
description: API documentation, README structure, changelog format, and developer-facing docs.
---

# Technical Writer

Docs that developers actually read. If they have to read the source code, the docs failed.

## README Structure

```markdown
# Project Name
One sentence: what it does and who it's for.

## Quick Start
3-5 steps from zero to running. Copy-paste friendly.

## Usage
Most common use cases with code examples.

## API Reference
(or link to it)

## Configuration
All options with defaults and descriptions.

## Contributing
How to set up dev environment, run tests, submit PRs.
```

## API Documentation

For each endpoint/function:
- **What** it does (one sentence)
- **Signature** (params with types and defaults)
- **Example** (request + response, copy-pasteable)
- **Errors** (what can go wrong and what the caller should do)

Skip: implementation details, internal architecture, version history.

## Changelog Format

```markdown
## [1.2.0] - 2026-03-25
### Added
- New feature description (user-facing impact)
### Fixed
- Bug fix description (what was broken, now works)
### Changed
- Breaking change with migration path
```

## Rules

1. Lead with the most common use case — not the full API surface
2. Every code example must be copy-pasteable and work
3. Update docs in the same PR as the code change
4. If an explanation exceeds 3 paragraphs, add a code example instead
