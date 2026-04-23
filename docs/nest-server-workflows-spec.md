# NestJS Server Workflow Specs for Lumen

## Goal

Add a server-side workflow system to the existing NestJS backend so that:

- quiz generation can continue when the user is not using the app
- key information extraction can continue when the user is not using the app
- the iOS app can consume a consistent async job model
- local on-device workflows can remain as a lite or fallback path without becoming the source of truth

This spec is written to align with the current iOS codebase in this repository:

- quiz result shape is based on [`QuizData`](/Users/darth_sky/Lumen/Lumen/analysis/QuizModels.swift#L30)
- current local key information workflow is based on [`KeyInformationExtractionWorkflow`](/Users/darth_sky/Lumen/Lumen/workflows/key_information/KeyInformationExtractionWorkflow.swift#L59)
- current prompt/backend message ownership is documented in [`README.md`](/Users/darth_sky/Lumen/Lumen/backend/ReadingAppServer/README.md#L1)

## Non-Goals

- Rewriting the iOS app in this phase
- Migrating every analysis task to the server immediately
- Designing a generic distributed workflow platform for unrelated products
- Defining the exact DB migration syntax for a specific ORM

## Product Requirements

The backend must support two async workflow families:

1. `quiz_generation`
2. `key_information_extraction`

The system must:

- allow work to continue after the client disconnects
- support retries and resumability
- preserve idempotency for repeated client submissions
- expose job status to the app
- let server-generated results supersede local lite results
- support later addition of review or repair steps

## High-Level Architecture

The NestJS server becomes the source of truth for long-running workflows.

### Responsibilities

**iOS app**

- submit workflow jobs
- poll or subscribe for workflow status
- display `lite` local results when available
- replace `lite` results with `server_final` results when they arrive

**NestJS backend**

- accept workflow requests
- deduplicate requests using idempotency keys
- enqueue and execute steps
- call LLM providers
- persist workflow state and output
- expose status and results APIs

**Queue layer**

- run async jobs outside the request lifecycle
- retry failed jobs
- limit concurrency per workflow type if needed

**Storage**

- workflow run state
- step attempts and error details
- final quiz output
- final key information output

## Recommended NestJS Module Layout

Use feature modules rather than a single monolithic workflow service.

```text
src/
  modules/
    workflows/
      workflows.module.ts
      workflows.controller.ts
      workflows.service.ts
      workflows.repository.ts
      dto/
      entities/
    workflow-queue/
      workflow-queue.module.ts
      workflow-queue.service.ts
      processors/
    quiz-workflow/
      quiz-workflow.module.ts
      quiz-workflow.service.ts
      quiz-workflow.processor.ts
      quiz-review.service.ts
      dto/
    key-info-workflow/
      key-info-workflow.module.ts
      key-info-workflow.service.ts
      key-info-workflow.processor.ts
      key-info-merger.service.ts
      dto/
    llm/
      llm.module.ts
      llm.service.ts
      providers/
    books/
      books.module.ts
      books.service.ts
      books.repository.ts
```

## Queue Technology

Recommended: `BullMQ` with Redis.

Reason:

- mature NestJS integration
- delayed jobs and retries are straightforward
- concurrency control is simple
- worker separation is easy if the system grows

Alternatives:

- database-backed polling jobs if operational simplicity is more important than throughput
- Temporal only if you want a full workflow engine and are willing to pay the complexity cost

For this product, BullMQ is the pragmatic default.

## Core Domain Model

There are two layers:

1. a generic workflow run model
2. workflow-specific payload and result models

### WorkflowRun

One row per submitted async workflow.

Suggested fields:

```ts
type WorkflowKind =
  | 'quiz_generation'
  | 'key_information_extraction';

type WorkflowStatus =
  | 'queued'
  | 'running'
  | 'retrying'
  | 'completed'
  | 'failed'
  | 'cancelled';

type WorkflowProducer =
  | 'server';

type WorkflowQualityTier =
  | 'server_final';
```

Suggested columns:

- `id` UUID
- `kind`
- `status`
- `book_id`
- `chapter_id`
- `chapter_index`
- `requested_by_user_id` nullable if anonymous/device-scoped
- `idempotency_key`
- `client_request_id` nullable
- `input_payload_json`
- `output_payload_json` nullable
- `error_code` nullable
- `error_message` nullable
- `attempt_count`
- `max_attempts`
- `priority`
- `producer` default `server`
- `quality_tier` default `server_final`
- `created_at`
- `updated_at`
- `started_at` nullable
- `completed_at` nullable

### WorkflowStepAttempt

Optional but strongly recommended for observability.

Suggested columns:

- `id`
- `workflow_run_id`
- `step_name`
- `attempt_number`
- `status`
- `input_summary_json`
- `output_summary_json`
- `error_message`
- `started_at`
- `completed_at`

This avoids opaque failures when a reviewer step or merge step misbehaves.

## Idempotency Rules

The app will trigger duplicate requests. That is normal.

Server rules:

- one active `quiz_generation` run per `(book_id, chapter_id, workflow_version)`
- one active `key_information_extraction` run per `(book_id, chapter_id, page_scope or chapter_scope, workflow_version)`

Suggested idempotency key shapes:

- quiz: `quiz:v1:{bookId}:{chapterId}`
- key info page-scoped: `keyinfo:v1:{bookId}:{chapterId}:page:{pageIndex}`
- key info chapter-scoped: `keyinfo:v1:{bookId}:{chapterId}:chapter`

If a matching active run already exists:

- return `202 Accepted`
- return the existing `workflow_run_id`
- do not enqueue a second copy

## Workflow API

The mobile app needs a simple async contract.

### 1. Submit Quiz Workflow

`POST /v1/workflows/quiz`

Request body:

```json
{
  "bookId": "book_123",
  "chapterId": "7",
  "chapterIndex": 7,
  "chapterTitle": "The Trial",
  "language": "en",
  "textSource": {
    "type": "chapter_text",
    "content": "..."
  },
  "clientRequestId": "req_123",
  "workflowVersion": "v1"
}
```

Response:

```json
{
  "workflowRunId": "uuid",
  "status": "queued",
  "kind": "quiz_generation",
  "deduped": false
}
```

### 2. Submit Key Information Workflow

`POST /v1/workflows/key-information`

Request body:

```json
{
  "bookId": "book_123",
  "chapterId": "7",
  "chapterIndex": 7,
  "chapterTitle": "The Trial",
  "scope": {
    "type": "page",
    "pageIndex": 12
  },
  "snapshot": {
    "sourceHash": "sha256",
    "pageParagraphs": {
      "0": "Paragraph one",
      "1": "Paragraph two"
    }
  },
  "workflowVersion": "v1"
}
```

The backend may later support `scope.type = chapter`.

### 3. Get Workflow Status

`GET /v1/workflows/:workflowRunId`

Response:

```json
{
  "id": "uuid",
  "kind": "quiz_generation",
  "status": "running",
  "bookId": "book_123",
  "chapterId": "7",
  "chapterIndex": 7,
  "attemptCount": 1,
  "qualityTier": "server_final",
  "producer": "server",
  "createdAt": "2026-04-21T10:00:00.000Z",
  "updatedAt": "2026-04-21T10:00:05.000Z",
  "completedAt": null,
  "resultAvailable": false,
  "error": null
}
```

### 4. Get Workflow Result

`GET /v1/workflows/:workflowRunId/result`

For quiz:

```json
{
  "workflowRunId": "uuid",
  "kind": "quiz_generation",
  "qualityTier": "server_final",
  "resultVersion": "v1",
  "result": {
    "questions": [
      {
        "id": "q1",
        "type": "multiple_choice",
        "question": "string",
        "options": ["a", "b", "c", "d"],
        "correctAnswerIndex": 0,
        "explanation": "string",
        "skill": "Facts"
      }
    ]
  }
}
```

The shape deliberately matches the current iOS `QuizData` contract.

### 5. Optional Book/Chapter Result Shortcut APIs

These are useful so the app does not need to know workflow ids forever.

- `GET /v1/books/:bookId/chapters/:chapterId/quiz`
- `GET /v1/books/:bookId/chapters/:chapterId/key-information`

These should return the latest completed server result plus metadata:

- `workflowRunId`
- `resultVersion`
- `updatedAt`
- `qualityTier`

## Quiz Workflow Spec

### Input

- `bookId`
- `chapterId`
- `chapterIndex`
- `chapterTitle` nullable
- `language` nullable
- full chapter text
- optional metadata such as reading level or target question count

### Output

Return a payload compatible with the iOS `QuizData` model:

- `questions[]`
  - `id`
  - `type = multiple_choice`
  - `question`
  - `options[4]`
  - `correctAnswerIndex`
  - `explanation`
  - `skill`

### Workflow Steps

Recommended v1 flow:

1. `normalize_input`
2. `generate_quiz`
3. `review_quiz`
4. `repair_quiz` if review fails
5. `finalize_result`
6. `persist_result`

### Step Details

#### 1. normalize_input

- trim whitespace
- reject empty text
- compute `content_hash`
- infer language if omitted

#### 2. generate_quiz

- call primary LLM with the existing quiz prompt semantics
- request strict JSON
- validate schema

#### 3. review_quiz

Use a second LLM or a second prompt pass to score:

- schema validity
- answer correctness against passage
- distractor plausibility
- duplication
- ambiguity
- skill label validity

Reviewer output:

```json
{
  "passed": true,
  "issues": [],
  "score": 0.92
}
```

#### 4. repair_quiz

If review fails:

- either regenerate whole quiz
- or repair only flagged questions

Recommended v1:

- allow up to 2 repair attempts
- after that fail the workflow

#### 5. finalize_result

- normalize question ids
- ensure exactly supported `skill` enum values
- enforce max and min question count

#### 6. persist_result

Store:

- raw result
- normalized result
- prompt/model metadata if useful for debugging

### Validation Rules

- 3 to 5 questions in v1
- exactly 4 options per question
- `correctAnswerIndex` within range
- `skill` in `Facts | Inference | Tone | Argument`
- no duplicate question ids

### Persistence

Use a dedicated table such as `chapter_quiz_results` or store in `workflow_runs.output_payload_json`.

Recommended split:

- keep canonical workflow state in `workflow_runs`
- keep latest materialized chapter result in `chapter_quiz_results`

Suggested `chapter_quiz_results` columns:

- `book_id`
- `chapter_id`
- `chapter_index`
- `workflow_run_id`
- `result_version`
- `questions_json`
- `content_hash`
- `created_at`
- `updated_at`

## Key Information Workflow Spec

### Input

For parity with the current iOS implementation, v1 should support page-scoped extraction first.

Required fields:

- `bookId`
- `chapterId`
- `chapterIndex`
- `pageIndex`
- `chapterTitle` nullable
- `sourceHash`
- `pageParagraphs`
- optional existing chapter memory or server book model state

### Output

The server should produce a normalized key information result that can later be converted into the iOS `BookModel` shape.

At minimum the workflow should output:

- `people`
- `events`
- `ideas`
- `entities`
- `themes`
- `relations`
- chapter summary fields if applicable

### Workflow Steps

Recommended v1 flow:

1. `load_existing_book_state`
2. `build_chunk`
3. `extract_chunk_knowledge`
4. `merge_into_chapter_memory`
5. `merge_into_book_model`
6. `mark_progress`
7. `persist_result`

This mirrors the current local Swift workflow structure closely enough to minimize semantic drift.

### Notes on v1 Scope

The current local workflow is page-scoped even though its naming is chapter-oriented. The server should preserve that behavior first instead of introducing broader chapter chunking in the same release.

That means:

- one workflow run updates one chapter page scope at a time
- the merged book model is incrementally updated
- repeated page updates are expected

### Data Dependencies

The workflow needs access to:

- current materialized book model, if any
- current chapter state, if any
- page/source hash for dedupe
- paragraph hash set for progress tracking

### Suggested Tables

`book_models`

- `book_id`
- `model_version`
- `model_json`
- `updated_at`

`key_information_progress`

- `book_id`
- `chapter_id`
- `chapter_index`
- `source_hash`
- `analysis_version`
- `processed_paragraph_hashes_json`
- `updated_at`

`chapter_key_information_results`

- `book_id`
- `chapter_id`
- `chapter_index`
- `page_index`
- `workflow_run_id`
- `result_json`
- `source_hash`
- `updated_at`

## LLM Abstraction

Do not bury provider-specific logic inside workflow services.

Use a shared `LlmService` abstraction:

```ts
interface LlmService {
  completeJson<T>(input: {
    task: string;
    prompt: string;
    model: string;
    schemaName: string;
    timeoutMs?: number;
    metadata?: Record<string, string>;
  }): Promise<T>;
}
```

This allows:

- primary model for quiz generation
- reviewer model for quiz review
- larger model for key information extraction
- future fallback routing

## Versioning

Every workflow kind must have an explicit version.

Examples:

- `quiz_generation@v1`
- `key_information_extraction@v1`

Version affects:

- idempotency key
- result interpretation
- prompt selection
- migration strategy

Never silently change prompt semantics without bumping workflow version if persisted outputs might differ materially.

## Client Integration Rules

The app should treat server workflows as canonical for background completion.

### App behavior for quiz

1. local lite result may appear first
2. app submits server workflow
3. app polls workflow status or fetches latest chapter result on foreground
4. if server result exists and is newer, replace local lite record

### App behavior for key information

1. local lite result may update current UI quickly
2. app submits page-scoped key info workflow
3. server result updates canonical book model
4. app refreshes the canonical model when foregrounded

### Metadata Needed in API Responses

- `producer`
- `qualityTier`
- `resultVersion`
- `updatedAt`
- `workflowRunId`

This lets the app compare local and server results cleanly.

## Failure Handling

### Retry Policy

Recommended defaults:

- transient LLM/network errors: retry up to 3 times with backoff
- schema validation failure after generation: 1 immediate repair attempt
- deterministic bad input: fail immediately

### Terminal Failure Shape

Expose a stable error contract:

```json
{
  "code": "QUIZ_REVIEW_FAILED",
  "message": "Quiz could not be validated after 2 repair attempts."
}
```

### Cancellation

Optional in v1. Safe to omit if jobs are short enough.

## Security and Auth

At minimum:

- authenticated users can only submit and read workflows for books they own
- idempotency keys are scoped per user
- raw chapter text should not be logged verbatim
- LLM prompt logging should be disabled or redacted in production

## Observability

Add metrics from day one:

- workflow submitted count by kind
- workflow success/failure count by kind
- median and p95 duration by kind
- LLM request count by task
- retry count
- deduped submission count

Structured logs should include:

- `workflowRunId`
- `kind`
- `bookId`
- `chapterId`
- `step`
- `attempt`

## Recommended Rollout Plan

### Phase 1

- implement generic workflow run model
- add BullMQ
- ship `quiz_generation@v1`
- expose submit/status/result endpoints
- keep iOS local quiz as empty or manual fallback only

### Phase 2

- implement `key_information_extraction@v1` page-scoped
- materialize server-side book model
- add foreground refresh in app

### Phase 3

- add reviewer/repair sophistication
- add push or websocket notifications
- add chapter-scoped key information runs if needed

## Open Questions

These should be resolved before implementation starts:

1. Will the server store raw chapter text, or is it request-only and ephemeral?
2. Is workflow ownership user-scoped, device-scoped, or book-scoped?
3. Do you want polling only in v1, or SSE/WebSocket as well?
4. Should key information remain page-scoped in v1, or should the server jump directly to chapter-scoped chunking?
5. Do you want canonical result tables separate from `workflow_runs`, or is `workflow_runs.output_payload_json` enough for the first release?

## Implementation Recommendation

Start with:

- BullMQ
- one generic `workflow_runs` table
- one dedicated `chapter_quiz_results` table
- one dedicated `book_models` table
- one dedicated `key_information_progress` table
- polling APIs only

That gives you a stable server workflow foundation without overbuilding.
