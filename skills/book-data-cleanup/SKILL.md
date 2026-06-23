---
name: book-data-cleanup
description: Use when resetting or deleting a book's persisted data in this repository, including local book-ingestion files, local knowledge-extraction store data, and production SurrealDB plus Railway volume data for the Reading-Assistant service. Trigger for requests like "重置这本书的数据", "清理一本书的 ingestion", "删除某本书的派生数据", or "reset book data" when the task is specifically about removing one book's stored state instead of clearing all data.
---

# Book Data Cleanup

Prefer the bundled script instead of manually recomputing book hashes, SurrealDB targets, or Railway paths.

## Default entrypoint

- Run `skills/book-data-cleanup/scripts/reset-book-data.sh --help`
- Read [references/operations.md](/Users/darth_sky/AI-Reading-Assistant/Reading-Assistant/skills/book-data-cleanup/references/operations.md) when you need the exact resolution order or failure handling.

## Safety rules

1. Prefer `--book-id` over title matching when the caller already knows the exact id.
2. Run a dry-run first. The script only mutates data when `--execute` is present.
3. Treat `--confirm-book-id` as mandatory for any real deletion. Resolve first, then rerun with the exact id.
4. Use `--env local` for workspace files and local SurrealDB.
5. Use `--env production` only when the user explicitly wants Railway production data changed.
6. For production cleanup, verify the resolved `bookId` in script output before running with `--execute`.

## Common commands

- Local dry-run by id:
  `skills/book-data-cleanup/scripts/reset-book-data.sh --env local --book-id 7F06D639-5F68-4EAC-9719-509F4ADA1B83`
- Local execute after dry-run:
  `skills/book-data-cleanup/scripts/reset-book-data.sh --env local --book-id 7F06D639-5F68-4EAC-9719-509F4ADA1B83 --execute --confirm-book-id 7F06D639-5F68-4EAC-9719-509F4ADA1B83`
- Production dry-run by title:
  `skills/book-data-cleanup/scripts/reset-book-data.sh --env production --title "Eros and the Mysteries of Love"`
- Production execute by id:
  `skills/book-data-cleanup/scripts/reset-book-data.sh --env production --book-id 9B2796FE-B5C9-4EB7-AD4E-A4EAD7B66C16 --execute --confirm-book-id 9B2796FE-B5C9-4EB7-AD4E-A4EAD7B66C16`

## What the script cleans

### Local

- `reading-app-server/data/book-ingestion/books/<hashed-book-id>/`
- matching entries in `reading-app-server/data/book-ingestion/store.json`
- matching runs in `reading-app-server/data/knowledge-extraction/store.json`
- matching SurrealDB graph data through `reading-app-server/scripts/delete-surreal-records.cjs` when the local DB is reachable

### Production

- matching SurrealDB graph data for the book in the Railway-linked environment
- `/data/book-ingestion/books/<hashed-book-id>/` inside the `Reading-Assistant` Railway service volume

## Operational notes

- Production cleanup depends on `railway variable list` for current Surreal credentials and `railway ssh` for volume deletion.
- Production volume deletion requires a working Railway SSH key on the current machine. If `railway ssh` fails, fix SSH access first rather than editing commands ad hoc.
- Title matching is case-insensitive substring matching. If multiple books match, stop and rerun with a narrower title or explicit `--book-id`.
