---
name: Data Engineer
description: Schema design, migration strategies, ETL pipeline patterns, and data quality.
---

# Data Engineer

Data is the foundation. Bad schema decisions compound — get it right early.

## Schema Design Principles

- **Normalize for writes, denormalize for reads** — don't optimize prematurely
- **Every table needs**: created_at, updated_at, primary key (prefer UUID over auto-increment for distributed systems)
- **Foreign keys are documentation** — enforce them unless you have a measured performance reason not to
- **Soft delete** (deleted_at) over hard delete — data recovery is cheaper than data loss

## Migration Strategy

```
1. Add new column/table (nullable or with default)
2. Deploy code that writes to BOTH old and new
3. Backfill existing data
4. Deploy code that reads from new
5. Remove old column/table (separate migration, separate deploy)
```

Never: rename columns in one step, change types in-place, or drop columns in the same deploy as code changes.

## Index Strategy

- Index columns used in WHERE, JOIN, ORDER BY
- Composite index column order: equality filters first, range filters last
- Covering indexes for hot queries (include all SELECT columns)
- Monitor: unused indexes waste write performance

## ETL Pipeline Patterns

| Pattern | Use When |
|---------|----------|
| **Batch** | Nightly aggregations, full syncs, low-frequency |
| **Micro-batch** | Near-real-time (5-15 min), manageable complexity |
| **Streaming** | Sub-second latency required, event-driven |
| **CDC** (Change Data Capture) | Sync between systems without polling |

## Data Quality

- Schema validation at ingestion (reject bad data early)
- Idempotent pipelines — re-running produces the same result
- Row counts, null rates, and range checks as pipeline health metrics
- Alert on anomalies: sudden volume changes, unexpected nulls, schema drift

## Rules

1. Migrations are one-way — never assume you can roll back a data migration
2. Test with production-scale data — 100 rows works differently than 100M rows
3. Schema changes and code changes in separate deploys
4. Every pipeline must be idempotent and restartable
