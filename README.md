# Reading Assistant

A developer-focused playground for building a “semantic reading IDE”. The app breaks long-form text into structured layers (document → paragraph → sentence → subsentence) and overlays model-driven annotations to help readers inspect meaning, rhetoric, and claims.

## Key Features

- **React front-end (`reading-app`)**: Renders source documents with layered highlights, hover cards, and semantic summaries.
- **Gemini-backed analysis server (`reading-app-server`)**: Turns envelopes into structured JSON using prompt templates (`prompts/v1/*`).
- **Hierarchical Analysis (v1)**:
  - **Skeleton**: Document-level structure, headings, and paragraph boundaries.
  - **Paragraph**: Rhetoric, roles, and core claims.
  - **Sentence**: Semantic roles, discourse function, and modal markers.
  - **Subsentence**: Micro-role analysis and dependency light tracking.
- **Unified Message Envelope**: A robust `Envelope v1` spec for Client↔Service communication, supporting streaming (NDJSON/SSE), idempotency, and observability.
- **Caching + Live LLM Analysis**: Persistent in-memory caching reduces repeat calls while the server uses the configured Gemini model.

## Getting Started

### Prerequisites

- Node.js 20.x (LTS) and npm 10.x
- **Google Gemini API Key** (for live mode)

### Installation

```bash
npm install
```

### Running the App

```bash
export GEMINI_API_KEY=your_key_here
export MODEL_ID=gemini-2.5-flash       # optional
npm run dev
```

## Configuration

Environment variables (`reading-app-server/services/config.ts`):

| Variable         | Default            | Description                                  |
| ---------------- | ------------------ | -------------------------------------------- |
| `PORT`           | `8787`             | API server listen port                       |
| `MODEL_ID`       | `gemini-2.5-flash` | LLM model identifier (Gemini)                |
| `GEMINI_API_KEY` | `""`               | Google Gemini API key                        |
| `LLM_DEBUG`      | `0`                | When truthy, log full prompts/responses      |
| `CACHE_TTL_MS`   | `7 days`           | TTL for in-memory response cache             |

## Repository Layout

```
reading-app/               # React front-end (Vite)
  src/components/          # Semantic UI components (Hover cards, highlights)
  src/services/envelopes.ts # Unified type system / contract
reading-app-server/        # Node.js HTTP server + handlers
  handlers/                # Analysis pipelines (paragraph, sentence, etc.)
  prompts/v1/              # Versioned prompt templates
  services/llmService.ts   # Google Generative AI adapter
resource/examples/         # Sample articles and test data
```

## Prompt Development

Prompt templates live in `reading-app-server/prompts/v1/`. Each handler loads its prompt at runtime, caches it in-memory, and injects the request context before calling the LLM. You can update prompt behavior without touching TypeScript code; just bump `prompt_version` in the client context if you need cache invalidation.
