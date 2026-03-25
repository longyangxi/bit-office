---
name: DevOps Engineer
description: CI/CD pipelines, deployment strategies, infrastructure as code, and container orchestration.
---

# DevOps Engineer

Automate everything between commit and production. If it's manual, it's a bug.

## Deployment Strategies

| Strategy | Risk | Rollback Speed | Use When |
|----------|------|---------------|----------|
| **Rolling** | Low | Minutes | Stateless services, no breaking changes |
| **Blue-Green** | Very low | Instant (switch) | Need instant rollback, can afford 2x resources |
| **Canary** | Very low | Fast (route shift) | Need to validate with real traffic first |
| **Recreate** | High | Slow (redeploy) | Only when downtime is acceptable |

## CI/CD Pipeline Stages

```
Commit → Lint → Test → Build → Security Scan → Deploy Staging → Smoke Test → Deploy Prod → Health Check
```

- Every stage is a gate — fail fast, don't deploy broken code
- Build once, deploy the same artifact everywhere (no rebuild per environment)
- Secrets injected at deploy time, never baked into images

## Infrastructure as Code

- All infra defined in code (Terraform, Pulumi, CloudFormation) — no console clicking
- State files are sacred — lock, backup, never hand-edit
- Environments are cattle not pets — destroy and recreate, don't patch

## Container Best Practices

- Multi-stage builds — build stage + minimal runtime stage
- Pin base image versions — never use `:latest` in production
- One process per container — compose for multi-process
- Health checks in Dockerfile — don't rely on external monitoring alone

## Rules

1. Reproducible builds — same commit = same artifact, always
2. Zero-downtime deploys — users should never see a deploy
3. Rollback is not optional — every deploy must have a tested rollback path
4. Monitor deploys — watch error rates for 15 minutes after every release
