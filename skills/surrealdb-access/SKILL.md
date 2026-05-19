---
name: surrealdb-access
description: Use when working with this repository's local SurrealDB instance, especially for ad hoc SQL queries, duplicate checks, schema inspection, and troubleshooting local access against the Lumen/test database defined in reading-app-server/.env.
---

# SurrealDB Access

This repository already has a fixed local SurrealDB access path. Prefer the repo scripts instead of rebuilding curl commands by hand.

## Default entrypoints

- Query SQL: `./scripts/surreal-query.sh "SELECT * FROM book;"`
- Check duplicates: `./scripts/surreal-check-duplicates.sh`
- Raw JSON payload: `./scripts/surreal-query.sh --json "INFO FOR DB;"`

## Connection assumptions

- Env is loaded from `reading-app-server/.env`, then `.env`, matching the server config.
- Default local target is `SURREAL_URL=http://127.0.0.1:8000`
- Default namespace and database are `Lumen` / `test`
- Auth uses `SURREAL_USER` and `SURREAL_PASS`

## Preferred workflow

1. Run `./scripts/surreal-query.sh "INFO FOR DB;"` to confirm connectivity and available tables.
2. Run focused SQL through `./scripts/surreal-query.sh`.
3. For duplicate checks, run `./scripts/surreal-check-duplicates.sh`.
4. If you need machine-readable output, add `--json`.

## Duplicate definitions

`surreal-check-duplicates` uses repo-specific business keys:

- `book`: `bookId`
- `chapter`: `bookId + chapterId`
- `person`: `normalizedName`
- `concept` / `theme`: `normalizedLabel`
- `entity`: `entityType + normalizedLabel`
- `event`: `bookId + chapterId + normalizedLabel`
- `appears_in`: `chapterRecordId + nodeRecordId`
- `related_to`: `chapterRecordId + fromRecordId + relationType + toRecordId`
- `part_of`: `bookRecordId + chapterRecordId`
- `workflow_run`: `idempotencyKey`
- `chapter_knowledge_snapshot`: `bookId + chapterId`
- `page_knowledge_extraction_cache`: `bookId + chapterId + pageIndex + promptVersion + sourceHash`
- `knowledge_evidence`: `ownerTable + ownerRecordId + pageIndex + pageNumber + quoteHash`

## Troubleshooting

- If `127.0.0.1:8000` is unreachable, check whether SurrealDB is already running before starting another process.
- If the data dir is locked, inspect the existing SurrealDB process instead of trying to open the same `surrealkv` path twice.
- If auth fails, verify `reading-app-server/.env` values before changing commands.
- If you need to start the local DB manually, use `./scripts/surrealDB-init.sh`.
