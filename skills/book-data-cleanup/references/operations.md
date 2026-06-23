# Book Cleanup Operations

## Resolution order

1. Prefer explicit `--book-id`.
2. For local title lookup, scan `reading-app-server/data/book-ingestion/books/*/book.json`.
3. For production title lookup, query Railway variables first, then search SurrealDB `book` and `chapter_knowledge_snapshot`.
4. After resolving the canonical `bookId`, derive the ingestion directory name as `sha256(bookId).slice(0, 32)`.

## Execution contract

- No mutation happens unless `--execute` is present.
- `--execute` also requires `--confirm-book-id <resolved-id>`.
- If title lookup returns multiple matches, stop and rerun with a narrower title or explicit `--book-id`.

## Local scope

- Try scoped deletion through `reading-app-server/scripts/delete-surreal-records.cjs`.
- Remove the split ingestion directory under `reading-app-server/data/book-ingestion/books/`.
- Remove the book entry from `reading-app-server/data/book-ingestion/store.json` if present.
- Remove matching runs from `reading-app-server/data/knowledge-extraction/store.json` if present.

## Production scope

- Read current SurrealDB credentials from `railway variable list --service Reading-Assistant --json`.
- Prefer the public Surreal hostname when Railway variables expose only an internal host.
- Delete graph data with `reading-app-server/scripts/delete-surreal-records.cjs --scope book`.
- Delete ingestion files with `railway ssh --service Reading-Assistant -- rm -rf /data/book-ingestion/books/<hashed-book-id>`.

## Failure modes

- `railway variable list` fails:
  authenticate Railway or fix network access before retrying.
- `railway ssh` fails:
  fix Railway SSH key registration first; do not rewrite the deletion path manually.
- local SurrealDB delete fails:
  the script logs and continues file cleanup, because local DB availability is optional for file reset.
- title not found in production `book` rows:
  the fallback chapter snapshot search may still identify the book.
