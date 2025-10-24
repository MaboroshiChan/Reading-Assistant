# Reading Assistant

A developer-focused playground for building a “semantic reading IDE”. The app
breaks long-form text into structured layers (document → paragraph → sentence →
subsentence) and overlays model-driven annotations to help readers inspect
meaning, rhetoric, and claims.

## Key Features

- **React front-end (`reading-app`)** renders source documents with layered
  highlights, hover cards, and semantic summaries.
- **LLM-backed analysis server (`reading-app-server`)** turns envelopes into
  structured JSON using prompt templates (`prompts/v1/*`). Mock generators are
  available for offline development.
- **Shared type system** (`reading-app/src/services/envelopes.ts`) keeps client
  and server DTOs in sync.
- **Caching + idempotent envelopes** allow fast replays and reproducible
  results.
- **Integration tests** exercise the message service against the HTTP router
  with either the live LLM or the deterministic mock layer.

## Getting Started

### Prerequisites

- Node.js 20.x (LTS) and npm 10.x
- Optional: OpenAI-compatible API key for live LLM calls

### Installation

```bash
npm install
```

### Running in Mock Mode (default)

Mock mode uses deterministic data builders and requires no external API calls.

```bash
export MOCK_LLM=1
npm run dev
```

This spins up both the Vite dev server (`reading-app`) and the API server
(`reading-app-server`) via `concurrently`. Open the printed URL to preview the
reading interface.

### Running with a Real LLM

```bash
export OPENAI_API_KEY=sk-...
export MODEL_ID=gpt-4o-mini          # optional (defaults to gpt-4o-mini)
unset MOCK_LLM                       # ensure the live client is used
npm run dev
```

The paragraph and sentence handlers will now:

1. Load the versioned prompt template from `reading-app-server/prompts/v1/`.
2. Inject request context (document metadata, neighboring sentences, task list).
3. Call `llmService.json()` against the OpenAI Responses API.
4. Coerce the response into typed DTOs, normalizing spans, anchors, and
   confidence scores.

## Configuration

Environment variables (`reading-app-server/services/config.ts`):

| Variable          | Default         | Description                                  |
| ----------------- | --------------- | -------------------------------------------- |
| `PORT`            | `8787`          | API server listen port                       |
| `MODEL_ID`        | `gpt-4o-mini`   | LLM model identifier                         |
| `OPENAI_API_KEY`  | `""`            | API key (required for live mode)             |
| `MOCK_LLM`        | `NODE_ENV=test` | When truthy, use mock generators             |
| `CACHE_TTL_MS`    | `7 days`        | TTL for in-memory response cache             |

## Running Tests

- **Unit / integration**: `npm test`
- **Type checking**: `npm run typecheck` (requires a project `tsconfig.json`)
- **Coverage**: `npm run coverage`

Tests default to mock mode (`MOCK_LLM=1`) so they run without external
dependencies.

## Prompt Development

Prompt templates live in `reading-app-server/prompts/v1/`. Each handler loads
its prompt at runtime, caches the template in-memory, and appends the request
payload/context before calling the LLM. Updating a prompt automatically changes
the server behaviour without touching TypeScript code; just bump
`prompt_version` in the client context when you need cache invalidation.

## Repository Layout

```
reading-app/               # React front-end (Vite)
reading-app-server/        # Express-free HTTP server + handlers
  handlers/
    paragraph.ts           # LLM pipeline for paragraphs
    sentence.ts            # LLM pipeline for sentences
    mock/*                 # Deterministic mock builders
  prompts/v1/              # Prompt templates (paragraph, sentence, etc.)
  services/llmService.ts   # OpenAI-compatible Responses API adapter
resource/examples/         # Markdown samples used in tests and demos
```

## Roadmap Highlights

- Expand live handlers for skeleton and subsentence analysis.
- Add richer evaluation tooling around prompt outputs.
- Surface LLM usage metadata through the UI for observability.
- Formalize downstream client components for hover/highlight UX.
