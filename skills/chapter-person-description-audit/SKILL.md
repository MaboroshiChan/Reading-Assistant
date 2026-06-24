---
name: chapter-person-description-audit
description: Use when validating chapter-level person description coverage in this repository's SurrealDB-backed knowledge graph, especially to distinguish between a DB-only audit and a true rerun of the LLM knowledge extraction workflow. Trigger for requests like "测试某章人物信息有没有缺", "重新跑 knowledge extraction 看人物摘录", "audit chapter people descriptions", "check Freakonomics introduction people coverage", or "see which person descriptions are missing in Surreal".
---

# Chapter Person Description Audit

Validate one chapter's person description coverage and explain what the current backend fallback logic would return.

## When to use

- The user reports that some chapter people show only names or blank detail views.
- You need a fast regression check after changing person description fallback logic.
- You need to confirm whether "testing" means a DB-only inspection or a true LLM workflow rerun.
- You want a before/after view of raw chapter descriptions, global person descriptions, relation backfills, and effective fallback output.

## Choose the right path

### 1. DB-only audit

Use this when the question is "what is in Surreal right now?" and you do not need to invoke the LLM again.

1. Resolve the target `bookId` and `chapterId`.
2. Choose the data source:
   - Local SurrealDB: use `reading-app-server/.env` defaults.
   - Railway/production SurrealDB: read Railway variables for `Reading-Assistant`, then use the public Surreal URL and credentials.
3. Run:

```bash
node skills/chapter-person-description-audit/scripts/audit_chapter_people.cjs \
  --book-id <BOOK_ID> \
  --chapter-id <CHAPTER_ID>
```

4. Read the summary:
   - `Raw chapter descriptions missing`
   - `Effective descriptions by source`
5. If any rows are missing raw chapter descriptions, inspect each person's:
   - `raw chapter`
   - `global`
   - `relation`
   - `effective (...)`

### 2. True LLM workflow rerun

Use this when the user explicitly says "跑 llm 任务", "rerun knowledge extraction", or otherwise expects a fresh workflow execution rather than a cache/data inspection.

1. Do not treat `audit_chapter_people.cjs` as the rerun step. That script only queries SurrealDB.
2. Use the existing isolated rerun harness:

```bash
node reading-app-server/scripts/evaluate-graph-dto-from-ingestion.cjs \
  --title "Freakonomics" \
  --chapter-id 4
```

3. This harness:
   - reads the current production source chapter
   - replays it into the Railway test service
   - uses a fresh isolated test database
   - submits `/v1/workflows/knowledge-extraction`
   - polls until the workflow completes
4. After the rerun succeeds, read the final JSON report and note:
   - `target.bookId`
   - `target.chapterId`
   - `target.namespace`
   - `target.database`
5. Run the audit script against that isolated test database to inspect the actual extracted people rows:

```bash
node skills/chapter-person-description-audit/scripts/audit_chapter_people.cjs \
  --book-id <TARGET_BOOK_ID> \
  --chapter-id <TARGET_CHAPTER_ID> \
  --ns <TARGET_NAMESPACE> \
  --db <TARGET_DATABASE>
```

6. If you are auditing Railway test data from the local machine, use the target service's public Surreal URL and credentials.

## Workflow notes

- `audit_chapter_people.cjs` is a DB audit only. It never invokes the LLM.
- The production knowledge extraction submit endpoint reuses the latest completed result for the same canonical snapshot, so "submit again" is not a guaranteed fresh rerun.
- For an actual rerun without mutating production state, prefer the isolated Railway test-service workflow above.
- If the user asks whether the test "really ran the LLM", the answer is only yes when you used the rerun harness or another path that created a fresh workflow execution.

## Interpreting results

- `effectiveDescriptionSource = chapter`
  - The chapter `appears_in.description` is already populated.
- `effectiveDescriptionSource = global`
  - Chapter description is missing, but global `person.description` can fill it.
- `effectiveDescriptionSource = relation`
  - Both chapter and global descriptions are missing; relation text can backfill it.
- `effectiveDescriptionSource = role`
  - Only roles exist; the fallback is synthesized from role labels.
- `effectiveDescriptionSource = default`
  - No useful description source exists. This is the strongest signal that extraction quality is incomplete.

## Production notes

- Prefer the public Surreal hostname when auditing from the local machine.
- Do not hardcode Railway credentials into files.
- For a concrete true-rerun example, see [references/freakonomics-introduction.md](references/freakonomics-introduction.md).
