# Chapter Open Analysis Backend Design

## Goal

When the user opens a chapter in iOS, the backend should automatically start the three chapter-level analysis tasks in the background:

1. `chapter-keywords` for key sentence highlighting
2. `knowledge-extraction`
3. `quiz`

The app should submit one backend request on chapter open instead of managing three independent calls.

## Current Backend Baseline

### Already exists

- `knowledge-extraction` is already implemented as a persisted async workflow module.
- `quiz` is already implemented as a persisted async workflow module.
- `knowledge-extraction` already auto-submits `quiz` after completion when `autoSubmitQuizWorkflow` is enabled.
- Both `knowledge-extraction` and `quiz` already share the same chapter-level Gemini prefix cache.

### Missing piece

- `chapter-keywords` currently exists only as a synchronous message handler.
- It has in-memory response cache and Gemini chunk prefix cache, but no persisted workflow state and no chapter-level latest-result API.
- Because of that, it cannot participate cleanly in a background orchestration pipeline yet.

## Design Decision

Introduce two backend layers:

1. `chapter-keywords-workflow` module
2. `chapter-open-analysis` orchestration module

This keeps responsibilities separate:

- `chapter-keywords-workflow` owns chunk planning, execution, persistence, and latest-result reads for key sentence highlighting.
- `chapter-open-analysis` owns chapter-open triggering, idempotency, aggregate status, and child workflow coordination.

Do not implement chapter-open orchestration by directly calling handler functions from a controller. That would bypass persisted workflow state and make retries, dedupe, and observability inconsistent with the existing workflow system.

## Proposed API

### 1. Submit on chapter open

`POST /v1/books/:bookId/chapters/:chapterId/open-analysis`

Request body:

```json
{
  "chapterIndex": 12,
  "pipelineVersion": "v1",
  "expectedSnapshotVersion": 44,
  "expectedChapterContentHash": "sha256...",
  "clientSessionId": "optional",
  "trigger": "chapter_open"
}
```

Response:

```json
{
  "chapterAnalysisRunId": "uuid",
  "status": "queued",
  "deduped": false,
  "pipelineVersion": "v1",
  "bookId": "book_1",
  "chapterId": "chapter_12",
  "chapterIndex": 12,
  "snapshotVersion": 44,
  "chapterContentHash": "sha256...",
  "tasks": {
    "chapterKeywords": { "status": "queued" },
    "knowledgeExtraction": { "status": "queued" },
    "quiz": { "status": "blocked" }
  }
}
```

### 2. Aggregate chapter-open status

`GET /v1/books/:bookId/chapters/:chapterId/open-analysis`

Returns the latest aggregate status for the canonical chapter state:

```json
{
  "pipelineVersion": "v1",
  "bookId": "book_1",
  "chapterId": "chapter_12",
  "chapterIndex": 12,
  "snapshotVersion": 44,
  "chapterContentHash": "sha256...",
  "chapterAnalysisRunId": "uuid",
  "status": "running",
  "tasks": {
    "chapterKeywords": {
      "status": "completed",
      "workflowRunId": "uuid"
    },
    "knowledgeExtraction": {
      "status": "running",
      "workflowRunId": "uuid"
    },
    "quiz": {
      "status": "blocked",
      "blockedBy": "knowledgeExtraction"
    }
  }
}
```

### 3. Aggregate result read

`GET /v1/books/:bookId/chapters/:chapterId/open-analysis/result`

Returns the latest materialized outputs for the current canonical chapter state:

```json
{
  "pipelineVersion": "v1",
  "bookId": "book_1",
  "chapterId": "chapter_12",
  "chapterIndex": 12,
  "snapshotVersion": 44,
  "chapterContentHash": "sha256...",
  "status": "partial",
  "data": {
    "chapterKeywords": { "...": "..." },
    "knowledgeExtraction": null,
    "quiz": null
  }
}
```

`status` rules:

- `completed`: all three task results exist for the same canonical chapter state
- `partial`: at least one task result exists but not all
- `running`: at least one child workflow is queued or running and no terminal aggregate result exists
- `failed`: orchestration failed before any usable state could be published
- `stale`: canonical chapter snapshot changed before pipeline completion

## New Module 1: `chapter-keywords-workflow`

### Why this is required

The orchestration layer needs `chapter-keywords` to behave like a real background workflow:

- dedupe by canonical chapter state
- persist latest result
- expose status/result API
- support retries and observability

### Responsibilities

- validate chapter state from canonical ingestion repository
- derive chunk plan from canonical chapter pages
- generate chunk-level keyword requests
- call the existing model logic
- merge chunk outputs into one chapter-level result
- persist run state and latest chapter result

### Internal refactor

Extract the current `handlers/chapter_keywords.ts` model-specific logic into a reusable service, for example:

- `chapter-keywords-llm.service.ts`

This service should own:

- prompt loading
- Gemini chunk prefix cache usage
- request-to-response sanitization

Then use it from:

- the legacy message handler
- the new `chapter-keywords-workflow` module

This avoids duplicating prompt and LLM behavior.

### Data model

Add repository state comparable to the existing workflow modules:

- `chapter_keywords_workflow_run`
- `chapter_keyword_results`

Suggested result key:

- `chapter-keywords:{workflowVersion}:{bookId}:{chapterId}:{chapterContentHash}`

Suggested workflow idempotency key:

- `chapter-keywords-run:{workflowVersion}:{bookId}:{chapterId}:{chapterContentHash}`

### API

Add:

- `POST /v1/workflows/chapter-keywords`
- `GET /v1/workflows/chapter-keywords/:workflowRunId`
- `GET /v1/workflows/chapter-keywords/:workflowRunId/result`
- `GET /v1/books/:bookId/chapters/:chapterId/chapter-keywords`

## New Module 2: `chapter-open-analysis`

### Responsibility

This module does not run LLM prompts itself. It orchestrates child workflows for the canonical chapter state.

### Execution flow

1. Validate canonical book and chapter state from `BookIngestionRepository`
2. Build aggregate idempotency key using `pipelineVersion + bookId + chapterId + chapterContentHash`
3. Create or reuse aggregate run
4. Enqueue orchestration execution through `WorkflowQueueService`
5. Submit `chapter-keywords-workflow`
6. Submit `knowledge-extraction-workflow`
7. Do not submit `quiz` directly if knowledge extraction auto-submit remains enabled
8. Poll or reconcile child workflow state until terminal aggregate status is reached
9. Publish aggregate result view

### Why quiz should remain owned by knowledge extraction

The current backend already encodes an important dependency:

- `quiz` requires a matching completed `knowledge-extraction` result
- `knowledge-extraction` already auto-submits `quiz`

Therefore the cleanest ownership model is:

- orchestration submits `knowledge-extraction`
- `knowledge-extraction` remains the component that decides when `quiz` may start
- orchestration only records the child `quiz` run id and tracks its status

This prevents duplicate submission paths and conflicting quiz ownership.

### Aggregate run state

Suggested aggregate run record:

```ts
type ChapterOpenAnalysisRunRecord = {
  id: string;
  kind: 'chapter_open_analysis';
  pipelineVersion: string;
  status: 'queued' | 'running' | 'completed' | 'partial' | 'failed' | 'stale';
  bookId: string;
  chapterId: string;
  chapterIndex: number;
  snapshotVersion: number;
  chapterContentHash: string;
  idempotencyKey: string;
  chapterKeywordsWorkflowRunId?: string;
  knowledgeExtractionWorkflowRunId?: string;
  quizWorkflowRunId?: string;
  createdAt: string;
  updatedAt: string;
  completedAt?: string;
  errorCode?: string;
  errorMessage?: string;
};
```

Suggested storage key:

- `chapter-open:{pipelineVersion}:{bookId}:{chapterId}:{chapterContentHash}`

## Chunk Planning for `chapter-keywords`

The backend should own chapter chunking, not iOS.

Recommended input source:

- canonical chapter pages from `BookIngestionRepository`
- paragraph order from `page.pageParagraphs`

Recommended process:

1. split each paragraph into sentences
2. build stable `SentenceRef` values from canonical page and paragraph positions
3. pack sentences into chunk requests using a token or character budget
4. keep chunk boundaries stable for the same canonical chapter content

Recommended result shape:

- persist one merged chapter-level result
- keep per-chunk intermediate records only for retry/debug if needed

## Idempotency and Deduplication

### Chapter-open request dedupe

If the user opens the same chapter repeatedly while the canonical chapter content is unchanged:

- reuse the same aggregate run
- do not create duplicate child workflow submissions

### Child workflow dedupe

Child workflows keep their own idempotency rules:

- `chapter-keywords-workflow` dedupe by chapter content hash
- `knowledge-extraction-workflow` already dedupes by chapter state
- `quiz-workflow` already dedupes by chapter state

The orchestration layer should treat child dedupe as normal behavior, not as an error.

## Failure Semantics

### Independent failures

One task failure should not erase the others.

Examples:

- `chapter-keywords` fails but `knowledge-extraction` and `quiz` succeed => aggregate status `partial`
- `knowledge-extraction` fails => `quiz` remains `blocked` or `failed_dependency`
- chapter content changes mid-run => aggregate status `stale`

### Retry rules

- retry `chapter-keywords-workflow` internally per chunk
- keep existing retry behavior for `knowledge-extraction` and `quiz`
- orchestration retries only submission/reconciliation steps, not LLM work already owned by child workflows

## Read Path for iOS

When a chapter is opened:

1. iOS calls `POST /v1/books/:bookId/chapters/:chapterId/open-analysis`
2. UI renders immediately from existing local/cached state if available
3. UI polls `GET /v1/books/:bookId/chapters/:chapterId/open-analysis`
4. UI separately fetches:
   - `GET /v1/books/:bookId/chapters/:chapterId/chapter-keywords`
   - `GET /v1/books/:bookId/chapters/:chapterId/knowledge-extraction`
   - `GET /v1/books/:bookId/chapters/:chapterId/quiz`

This keeps product-facing reads simple and avoids making the aggregate result endpoint a mandatory dependency for every screen.

## Recommended Implementation Order

### Phase 1

- extract reusable `chapter-keywords` LLM service from the current handler
- implement `chapter-keywords-workflow` module
- add latest chapter keyword result endpoint

### Phase 2

- implement `chapter-open-analysis` repository, service, controller, and DTOs
- wire orchestration to submit `chapter-keywords` and `knowledge-extraction`
- reconcile downstream `quiz` run created by knowledge extraction auto-submit

### Phase 3

- add metrics and logs for aggregate chapter-open pipeline health
- add stale-run cleanup and better aggregate result materialization

## Why this design is preferable

- one app trigger instead of three client-managed tasks
- keeps the server as source of truth for background completion
- preserves the existing knowledge-extraction -> quiz dependency
- avoids mixing sync message handlers with async workflow ownership
- lets `chapter-keywords` finally participate in the same persistence and observability model as the other two tasks

## Non-Goals

- replacing the current message envelope API immediately
- forcing all readers to consume the aggregate result endpoint
- introducing a general-purpose workflow engine beyond the current app needs
