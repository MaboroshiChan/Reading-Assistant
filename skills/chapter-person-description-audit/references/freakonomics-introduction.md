# Freakonomics Introduction Validation

Use this as the standard example when the user asks to test whether people descriptions survive a real knowledge extraction rerun.

## Source chapter

- Production title: `Freakonomics`
- Production `bookId`: `3D744C27-6D8C-4D4E-9367-BF5EE5DEF441`
- Production `chapterId`: `4`
- Chapter title: `Introduction`

## Important distinction

- Running `audit_chapter_people.cjs` against production only inspects the data that already exists in SurrealDB.
- Running `evaluate-graph-dto-from-ingestion.cjs` against this chapter performs a fresh workflow execution in the Railway test service and is the correct answer to "跑 llm 任务测试一下".

## True rerun command

```bash
node reading-app-server/scripts/evaluate-graph-dto-from-ingestion.cjs \
  --title "Freakonomics" \
  --chapter-id 4
```

## What to read from the rerun report

From the final JSON output, keep:

- `source.bookId`
- `source.chapterId`
- `target.bookId`
- `target.chapterId`
- `target.namespace`
- `target.database`
- `workflow.workflowRunId`
- `workflow.status`

The `target.*` identifiers are the ones to use for follow-up auditing because the rerun creates cloned IDs inside the isolated test database.

## Follow-up audit command

```bash
node skills/chapter-person-description-audit/scripts/audit_chapter_people.cjs \
  --book-id <TARGET_BOOK_ID> \
  --chapter-id <TARGET_CHAPTER_ID> \
  --ns <TARGET_NAMESPACE> \
  --db <TARGET_DATABASE>
```

Use the Railway test service's public Surreal URL and credentials if they are not already present in the shell environment.

## Expected result for the known-good chapter

- The workflow should complete successfully.
- The audit should show `People: 10`.
- The audit should show `Raw chapter descriptions missing: 0`.
- The effective description source should stay on `chapter` for every person.
