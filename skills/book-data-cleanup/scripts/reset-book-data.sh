#!/bin/bash

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
DEFAULT_READING_ASSISTANT_SERVICE="Reading-Assistant"

usage() {
  cat <<'EOF'
Usage:
  skills/book-data-cleanup/scripts/reset-book-data.sh [options]

Options:
  --env <local|production>   Target environment. Default: local
  --book-id <id>             Exact book id to delete
  --title <text>             Case-insensitive substring title match
  --service <name>           Railway service name for production. Default: Reading-Assistant
  --execute                  Apply deletion. Without this flag, run dry-run only.
  --confirm-book-id <id>     Required together with --execute. Must match the resolved book id.
  --help                     Show this help

Examples:
  skills/book-data-cleanup/scripts/reset-book-data.sh --env local --book-id book-1
  skills/book-data-cleanup/scripts/reset-book-data.sh --env local --title "Freakonomics"
  skills/book-data-cleanup/scripts/reset-book-data.sh --env local --title "Freakonomics" --execute --confirm-book-id 7F06D639-5F68-4EAC-9719-509F4ADA1B83
  skills/book-data-cleanup/scripts/reset-book-data.sh --env production --title "Eros and the Mysteries of Love"
  skills/book-data-cleanup/scripts/reset-book-data.sh --env production --book-id 9B2796FE-B5C9-4EB7-AD4E-A4EAD7B66C16 --execute --confirm-book-id 9B2796FE-B5C9-4EB7-AD4E-A4EAD7B66C16
EOF
}

log() {
  printf '[book-data-cleanup] %s\n' "$*"
}

fail() {
  log "$*"
  exit 1
}

require_command() {
  command -v "$1" >/dev/null 2>&1 || fail "Missing required command: $1"
}

json_string() {
  node -e 'process.stdout.write(JSON.stringify(process.argv[1]))' "$1"
}

BOOK_ID=""
TITLE=""
TARGET_ENV="local"
EXECUTE=0
CONFIRM_BOOK_ID=""
READING_ASSISTANT_SERVICE="$DEFAULT_READING_ASSISTANT_SERVICE"

while [[ $# -gt 0 ]]; do
  case "$1" in
    --env)
      TARGET_ENV="${2:-}"
      shift 2
      ;;
    --book-id)
      BOOK_ID="${2:-}"
      shift 2
      ;;
    --title)
      TITLE="${2:-}"
      shift 2
      ;;
    --service)
      READING_ASSISTANT_SERVICE="${2:-}"
      shift 2
      ;;
    --confirm-book-id)
      CONFIRM_BOOK_ID="${2:-}"
      shift 2
      ;;
    --execute)
      EXECUTE=1
      shift
      ;;
    --help|-h)
      usage
      exit 0
      ;;
    *)
      fail "Unknown argument: $1"
      ;;
  esac
done

[[ "$TARGET_ENV" == "local" || "$TARGET_ENV" == "production" ]] || fail "--env must be local or production"
[[ -n "$BOOK_ID" || -n "$TITLE" ]] || fail "Provide --book-id or --title"
[[ -z "$BOOK_ID" || -z "$TITLE" ]] || fail "Use either --book-id or --title, not both"
[[ $EXECUTE -eq 1 && -n "$CONFIRM_BOOK_ID" ]] || [[ $EXECUTE -eq 0 ]] || fail "--confirm-book-id is required with --execute"

resolve_local_book() {
  local title="$1"
  node - "$ROOT_DIR" "$title" <<'NODE'
const fs = require('node:fs');
const path = require('node:path');

const rootDir = process.argv[2];
const needle = process.argv[3].toLowerCase();
const booksDir = path.join(rootDir, 'reading-app-server', 'data', 'book-ingestion', 'books');

if (!fs.existsSync(booksDir)) process.exit(2);

const matches = [];
for (const entry of fs.readdirSync(booksDir, { withFileTypes: true })) {
  if (!entry.isDirectory()) continue;
  const manifestPath = path.join(booksDir, entry.name, 'book.json');
  if (!fs.existsSync(manifestPath)) continue;
  const raw = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  const title = String(raw?.bookMetadata?.title ?? '');
  if (title.toLowerCase().includes(needle)) {
    matches.push({
      bookId: String(raw.bookId ?? ''),
      hashedBookId: entry.name,
      title,
    });
  }
}

process.stdout.write(JSON.stringify(matches));
NODE
}

resolve_production_book() {
  local title="$1"
  local vars_json="$2"
  local escaped_title
  escaped_title="$(json_string "$title")"

  node - "$vars_json" "$escaped_title" <<'NODE'
const vars = JSON.parse(process.argv[2]);
const title = JSON.parse(process.argv[3]);
const required = ['SURREAL_URL', 'SURREAL_NS', 'SURREAL_DB', 'SURREAL_USER', 'SURREAL_PASS'];
for (const key of required) {
  if (!vars[key]) {
    console.error(`Missing Railway variable: ${key}`);
    process.exit(1);
  }
}
console.log(JSON.stringify({
  url: (() => {
    const raw = String(vars.SURREAL_URL).replace(/\/+$/, '');
    const publicHost = String(vars.RAILWAY_SERVICE_SURREALDB_3_X_LATEST__URL ?? '').trim();
    if (raw.includes('railway.internal') && publicHost) return `https://${publicHost}`;
    return raw;
  })(),
  ns: String(vars.SURREAL_NS),
  db: String(vars.SURREAL_DB),
  user: String(vars.SURREAL_USER),
  pass: String(vars.SURREAL_PASS),
  needle: String(title).toLowerCase(),
}));
NODE
}

sha_book_dir() {
  node -e "const {createHash}=require('node:crypto'); process.stdout.write(createHash('sha256').update(process.argv[1]).digest('hex').slice(0,32));" "$1"
}

mutate_local_store_file() {
  local file_path="$1"
  local kind="$2"
  local book_id="$3"
  [[ -f "$file_path" ]] || return 0

  node - "$file_path" "$kind" "$book_id" <<'NODE'
const fs = require('node:fs');

const filePath = process.argv[2];
const kind = process.argv[3];
const bookId = process.argv[4];
const raw = JSON.parse(fs.readFileSync(filePath, 'utf8'));

if (kind === 'book-ingestion') {
  if (raw && raw.books && typeof raw.books === 'object') {
    delete raw.books[bookId];
  }
}

if (kind === 'knowledge-extraction') {
  if (raw && raw.runs && typeof raw.runs === 'object') {
    for (const [key, value] of Object.entries(raw.runs)) {
      if (value && value.bookId === bookId) delete raw.runs[key];
    }
  }
}

fs.writeFileSync(filePath, `${JSON.stringify(raw, null, 2)}\n`);
NODE
}

delete_local_files() {
  local book_id="$1"
  local hashed_book_id="$2"
  local ingestion_dir="$ROOT_DIR/reading-app-server/data/book-ingestion/books/$hashed_book_id"
  local legacy_book_store="$ROOT_DIR/reading-app-server/data/book-ingestion/store.json"
  local knowledge_store="$ROOT_DIR/reading-app-server/data/knowledge-extraction/store.json"

  if [[ $EXECUTE -eq 0 ]]; then
    log "Would remove local ingestion dir: $ingestion_dir"
    [[ -f "$legacy_book_store" ]] && log "Would remove $book_id from $legacy_book_store"
    [[ -f "$knowledge_store" ]] && log "Would remove runs for $book_id from $knowledge_store"
    return 0
  fi

  rm -rf "$ingestion_dir"
  mutate_local_store_file "$legacy_book_store" "book-ingestion" "$book_id"
  mutate_local_store_file "$knowledge_store" "knowledge-extraction" "$book_id"
  log "Removed local file-based data for $book_id"
}

delete_surreal_local() {
  local book_id="$1"
  local args=(node reading-app-server/scripts/delete-surreal-records.cjs --scope book --bookId "$book_id")
  [[ $EXECUTE -eq 0 ]] && args+=(--dry-run)

  if ! (cd "$ROOT_DIR" && "${args[@]}"); then
    if [[ $TARGET_ENV == "local" ]]; then
      log "Local SurrealDB cleanup skipped because delete-surreal-records.cjs failed"
    fi
  fi
}

load_railway_vars() {
  require_command railway
  railway variable list --service "$READING_ASSISTANT_SERVICE" --json
}

delete_surreal_production() {
  local book_id="$1"
  local vars_json="$2"
  local env_exports
  env_exports="$(node - "$vars_json" <<'NODE'
const vars = JSON.parse(process.argv[2]);
for (const key of ['SURREAL_URL', 'SURREAL_NS', 'SURREAL_DB', 'SURREAL_USER', 'SURREAL_PASS']) {
  if (!vars[key]) {
    console.error(`Missing Railway variable: ${key}`);
    process.exit(1);
  }
}
process.stdout.write([
  `SURREAL_URL=${JSON.stringify((() => {
    const raw = String(vars.SURREAL_URL).trim();
    const publicHost = String(vars.RAILWAY_SERVICE_SURREALDB_3_X_LATEST__URL ?? '').trim();
    if (raw.includes('railway.internal') && publicHost) return `https://${publicHost}`;
    return raw;
  })())}`,
  `SURREAL_NS=${JSON.stringify(String(vars.SURREAL_NS))}`,
  `SURREAL_DB=${JSON.stringify(String(vars.SURREAL_DB))}`,
  `SURREAL_USER=${JSON.stringify(String(vars.SURREAL_USER))}`,
  `SURREAL_PASS=${JSON.stringify(String(vars.SURREAL_PASS))}`,
].join('\n'));
NODE
)"

  local dry_flag=()
  [[ $EXECUTE -eq 0 ]] && dry_flag+=(--dry-run)

  (
    cd "$ROOT_DIR"
    eval "$env_exports"
    node reading-app-server/scripts/delete-surreal-records.cjs --scope book --bookId "$book_id" "${dry_flag[@]}"
  )
}

delete_production_ingestion() {
  local hashed_book_id="$1"
  local remote_dir="/data/book-ingestion/books/$hashed_book_id"

  if [[ $EXECUTE -eq 0 ]]; then
    log "Would remove production ingestion dir: $remote_dir"
    return 0
  fi

  railway ssh --service "$READING_ASSISTANT_SERVICE" -- rm -rf "$remote_dir"
  log "Removed production ingestion dir: $remote_dir"
}

resolve_production_candidates() {
  local vars_json="$1"
  local title="$2"
  local conn_json sql response
  conn_json="$(resolve_production_book "$title" "$vars_json")"
  sql="SELECT bookId, bookMetadata.title FROM book; SELECT bookId, result.title, result.summary FROM chapter_knowledge_snapshot;"

  response="$(
    node - "$conn_json" "$sql" <<'NODE'
const conn = JSON.parse(process.argv[2]);
const sql = process.argv[3];

fetch(`${conn.url}/sql`, {
  method: 'POST',
  headers: {
    Accept: 'application/json',
    Authorization: `Basic ${Buffer.from(`${conn.user}:${conn.pass}`, 'utf8').toString('base64')}`,
    'Surreal-NS': conn.ns,
    'Surreal-DB': conn.db,
    'Content-Type': 'text/plain',
  },
  body: sql,
})
  .then(async (res) => {
    const payload = await res.json();
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    process.stdout.write(JSON.stringify(payload));
  })
  .catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  });
NODE
  )"

  node - "$response" "$title" <<'NODE'
const payload = JSON.parse(process.argv[2]);
const needle = process.argv[3].toLowerCase();
const matches = new Map();

const bookRows = Array.isArray(payload?.[0]?.result) ? payload[0].result : [];
for (const row of bookRows) {
  const title = String(row?.bookMetadata?.title ?? '');
  if (title.toLowerCase().includes(needle)) {
    matches.set(String(row.bookId), { bookId: String(row.bookId), title });
  }
}

const snapshotRows = Array.isArray(payload?.[1]?.result) ? payload[1].result : [];
for (const row of snapshotRows) {
  const summary = String(row?.result?.summary ?? '');
  const chapterTitle = String(row?.result?.title ?? '');
  if (summary.toLowerCase().includes(needle) || chapterTitle.toLowerCase().includes(needle)) {
    const current = matches.get(String(row.bookId)) ?? { bookId: String(row.bookId), title: chapterTitle || summary.slice(0, 120) };
    matches.set(String(row.bookId), current);
  }
}

process.stdout.write(JSON.stringify(Array.from(matches.values())));
NODE
}

BOOK_TITLE=""
HASHED_BOOK_ID=""

if [[ -n "$BOOK_ID" ]]; then
  HASHED_BOOK_ID="$(sha_book_dir "$BOOK_ID")"
else
  if [[ "$TARGET_ENV" == "local" ]]; then
    matches_json="$(resolve_local_book "$TITLE")"
  else
    railway_vars_json="$(load_railway_vars)"
    matches_json="$(resolve_production_candidates "$railway_vars_json" "$TITLE")"
  fi

  match_count="$(node -e 'const items=JSON.parse(process.argv[1]); process.stdout.write(String(items.length));' "$matches_json")"
  [[ "$match_count" -gt 0 ]] || fail "No matching book found for title: $TITLE"
  [[ "$match_count" -eq 1 ]] || fail "Multiple books matched title: $TITLE"

  BOOK_ID="$(node -e 'const items=JSON.parse(process.argv[1]); process.stdout.write(items[0].bookId);' "$matches_json")"
  BOOK_TITLE="$(node -e 'const items=JSON.parse(process.argv[1]); process.stdout.write(items[0].title || "");' "$matches_json")"
  HASHED_BOOK_ID="$(sha_book_dir "$BOOK_ID")"
fi

if [[ -z "$BOOK_TITLE" && "$TARGET_ENV" == "local" && -d "$ROOT_DIR/reading-app-server/data/book-ingestion/books/$HASHED_BOOK_ID" ]]; then
  BOOK_TITLE="$(node -e 'const fs=require("node:fs"); const p=process.argv[1]; const raw=JSON.parse(fs.readFileSync(p,"utf8")); process.stdout.write(String(raw?.bookMetadata?.title ?? ""));' "$ROOT_DIR/reading-app-server/data/book-ingestion/books/$HASHED_BOOK_ID/book.json")"
fi

log "Resolved environment: $TARGET_ENV"
log "Resolved bookId: $BOOK_ID"
log "Resolved hashedBookId: $HASHED_BOOK_ID"
[[ -n "$BOOK_TITLE" ]] && log "Resolved title: $BOOK_TITLE"
[[ $EXECUTE -eq 0 ]] && log "Mode: dry-run" || log "Mode: execute"

if [[ $EXECUTE -eq 1 && "$CONFIRM_BOOK_ID" != "$BOOK_ID" ]]; then
  fail "--confirm-book-id does not match resolved bookId"
fi

if [[ $EXECUTE -eq 0 ]]; then
  if [[ -n "$TITLE" ]]; then
    log "Confirm command: skills/book-data-cleanup/scripts/reset-book-data.sh --env $TARGET_ENV --book-id $BOOK_ID --execute --confirm-book-id $BOOK_ID"
  else
    log "Confirm command: skills/book-data-cleanup/scripts/reset-book-data.sh --env $TARGET_ENV --book-id $BOOK_ID --execute --confirm-book-id $BOOK_ID"
  fi
fi

if [[ "$TARGET_ENV" == "local" ]]; then
  delete_surreal_local "$BOOK_ID"
  delete_local_files "$BOOK_ID" "$HASHED_BOOK_ID"
else
  railway_vars_json="${railway_vars_json:-$(load_railway_vars)}"
  delete_surreal_production "$BOOK_ID" "$railway_vars_json"
  delete_production_ingestion "$HASHED_BOOK_ID"
fi

log "Completed"
