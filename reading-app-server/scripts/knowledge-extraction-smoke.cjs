const { randomUUID } = require('node:crypto');

const LIVE_SERVER_URL = process.env.LIVE_SERVER_URL && process.env.LIVE_SERVER_URL.trim();
const VALIDATION_MODE = normalizeMode(process.env.VALIDATION_MODE);
const POLL_INTERVAL_MS = Number(process.env.SMOKE_POLL_INTERVAL_MS ?? 2_000);
const POLL_TIMEOUT_MS = Number(process.env.SMOKE_POLL_TIMEOUT_MS ?? 120_000);

function normalizeMode(value) {
  if (value === 'manual' || value === 'auto' || value === 'both') {
    return value;
  }
  return 'both';
}

function requireLiveServerUrl() {
  if (!LIVE_SERVER_URL) {
    throw new Error('LIVE_SERVER_URL is required');
  }
  return LIVE_SERVER_URL.replace(/\/+$/, '');
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function logStep(step, details) {
  const suffix = details ? ` ${JSON.stringify(details)}` : '';
  console.log(`[smoke][${step}]${suffix}`);
}

function fail(step, message, details) {
  const payload = details ? ` ${JSON.stringify(details, null, 2)}` : '';
  throw new Error(`[${step}] ${message}${payload}`);
}

async function requestJson(step, url, init) {
  const response = await fetch(url, init);
  const rawText = await response.text();

  let body = rawText;
  if (rawText) {
    try {
      body = JSON.parse(rawText);
    } catch {
      body = rawText;
    }
  }

  if (!response.ok) {
    fail(step, 'Request failed', {
      endpoint: url,
      httpStatus: response.status,
      body,
    });
  }

  return {
    status: response.status,
    body,
  };
}

function buildScenario(name) {
  const unique = randomUUID().slice(0, 8);
  const chapterIndex = name === 'manual' ? 101 : 102;

  return {
    name,
    bookId: `smoke-ke-${name}-${unique}`,
    chapterId: `ch-${name}-${unique}`,
    chapterIndex,
    chapterTitle: `Smoke ${name} chapter ${unique}`,
    pageIndex: 0,
    sourceHash: `${name}-source-${unique}`,
    pageParagraphs: name === 'manual'
      ? {
        '0': 'The chapter follows a historian who compares eyewitness notes before drawing a conclusion.',
        '1': 'It argues that patient evidence gathering reveals the strongest account of events.',
      }
      : {
        '0': 'The chapter describes a committee revising its rules after public criticism and debate.',
        '1': 'That sequence is presented as evidence of institutional adaptation and practical learning.',
      },
  };
}

async function uploadPage(baseUrl, scenario) {
  const url = `${baseUrl}/v1/books/${scenario.bookId}/chapters/${scenario.chapterId}/pages/${scenario.pageIndex}`;
  const response = await requestJson('upsert-page', url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      bookId: scenario.bookId,
      chapterId: scenario.chapterId,
      chapterIndex: scenario.chapterIndex,
      chapterTitle: scenario.chapterTitle,
      pageIndex: scenario.pageIndex,
      sourceHash: scenario.sourceHash,
      pageParagraphs: scenario.pageParagraphs,
    }),
  });

  assertUpsertResponse(response.body, scenario);
  return response.body;
}

function assertUpsertResponse(response, scenario) {
  assert(response.bookId === scenario.bookId, 'upsert.bookId mismatch', { response, scenario });
  assert(response.chapterId === scenario.chapterId, 'upsert.chapterId mismatch', { response, scenario });
  assert(response.chapterIndex === scenario.chapterIndex, 'upsert.chapterIndex mismatch', { response, scenario });
  assert(response.pageIndex === scenario.pageIndex, 'upsert.pageIndex mismatch', { response, scenario });
  assert(typeof response.snapshotVersion === 'number' && response.snapshotVersion >= 1, 'upsert.snapshotVersion invalid', { response });
  assert(typeof response.chapterContentHash === 'string' && response.chapterContentHash.length > 0, 'upsert.chapterContentHash invalid', { response });
  assert(response.chapterTextAvailable === true, 'upsert.chapterTextAvailable should be true', { response });
}

async function submitWorkflow(baseUrl, scenario, upsert, idempotencyKey) {
  const url = `${baseUrl}/v1/workflows/knowledge-extraction`;
  const response = await requestJson('submit-workflow', url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      bookId: scenario.bookId,
      chapterId: scenario.chapterId,
      chapterIndex: scenario.chapterIndex,
      workflowVersion: 'v1',
      idempotencyKey,
      expectedSnapshotVersion: upsert.snapshotVersion,
      expectedChapterContentHash: upsert.chapterContentHash,
    }),
  });

  const body = response.body;
  assert(body.kind === 'knowledge_extraction', 'submit.kind mismatch', { body });
  assert(body.bookId === scenario.bookId, 'submit.bookId mismatch', { body });
  assert(body.chapterId === scenario.chapterId, 'submit.chapterId mismatch', { body });
  assert(body.chapterIndex === scenario.chapterIndex, 'submit.chapterIndex mismatch', { body });
  assert(body.workflowVersion === 'v1', 'submit.workflowVersion mismatch', { body });
  assert(typeof body.workflowRunId === 'string' && body.workflowRunId.length > 0, 'submit.workflowRunId invalid', { body });
  return body;
}

async function pollWorkflowStatus(baseUrl, workflowRunId) {
  const deadline = Date.now() + POLL_TIMEOUT_MS;
  let lastBody = null;

  while (Date.now() <= deadline) {
    const url = `${baseUrl}/v1/workflows/knowledge-extraction/${workflowRunId}`;
    const response = await requestJson('poll-workflow-status', url);
    lastBody = response.body;

    if (lastBody.status === 'completed') {
      return lastBody;
    }

    if (lastBody.status === 'failed' || lastBody.status === 'stale') {
      fail('poll-workflow-status', 'Workflow reached non-success terminal state', {
        endpoint: url,
        terminalState: lastBody,
      });
    }

    await sleep(POLL_INTERVAL_MS);
  }

  fail('poll-workflow-status', 'Timed out waiting for workflow completion', {
    workflowRunId,
    lastStatus: lastBody,
    timeoutMs: POLL_TIMEOUT_MS,
  });
}

async function fetchWorkflowResult(baseUrl, workflowRunId) {
  const url = `${baseUrl}/v1/workflows/knowledge-extraction/${workflowRunId}/result`;
  const response = await requestJson('fetch-workflow-result', url);
  assertKnowledgeResult(response.body.result, 'fetch-workflow-result');
  return response.body;
}

async function fetchLatestResult(baseUrl, scenario) {
  const url = `${baseUrl}/v1/books/${scenario.bookId}/chapters/${scenario.chapterId}/knowledge-extraction`;
  const response = await requestJson('fetch-latest-result', url);
  assertKnowledgeResult(response.body.result, 'fetch-latest-result');
  return response.body;
}

async function pollLatestResult(baseUrl, scenario) {
  const deadline = Date.now() + POLL_TIMEOUT_MS;
  let lastStatus = null;
  let lastBody = null;
  const url = `${baseUrl}/v1/books/${scenario.bookId}/chapters/${scenario.chapterId}/knowledge-extraction`;

  while (Date.now() <= deadline) {
    const response = await fetch(url);
    const rawText = await response.text();
    lastStatus = response.status;

    try {
      lastBody = rawText ? JSON.parse(rawText) : null;
    } catch {
      lastBody = rawText;
    }

    if (response.status === 200) {
      const body = lastBody;
      assertKnowledgeResult(body.result, 'poll-latest-result');
      return body;
    }

    if (response.status !== 404) {
      fail('poll-latest-result', 'Unexpected status while polling latest result', {
        endpoint: url,
        httpStatus: response.status,
        body: lastBody,
      });
    }

    await sleep(POLL_INTERVAL_MS);
  }

  fail('poll-latest-result', 'Timed out waiting for latest result', {
    endpoint: url,
    lastHttpStatus: lastStatus,
    lastBody,
    timeoutMs: POLL_TIMEOUT_MS,
  });
}

function assertKnowledgeResult(result, step) {
  assert(result && typeof result === 'object', `${step}.result missing`, { result });
  assert(typeof result.title === 'string' && result.title.trim().length > 0, `${step}.title invalid`, { result });
  assert(typeof result.summary === 'string' && result.summary.trim().length > 0, `${step}.summary invalid`, { result });
  assert(Array.isArray(result.people), `${step}.people must be an array`, { result });
  assert(Array.isArray(result.ideas), `${step}.ideas must be an array`, { result });
  assert(Array.isArray(result.events), `${step}.events must be an array`, { result });
  assert(Array.isArray(result.entities), `${step}.entities must be an array`, { result });
  assert(Array.isArray(result.themes), `${step}.themes must be an array`, { result });
  assert(Array.isArray(result.relations), `${step}.relations must be an array`, { result });

  for (const person of result.people) {
    assert(typeof person.local_id === 'string' && person.local_id.length > 0, `${step}.people.local_id invalid`, { person });
    assert(typeof person.name === 'string' && person.name.trim().length > 0, `${step}.people.name invalid`, { person });
  }

  for (const idea of result.ideas) {
    assert(typeof idea.local_id === 'string' && idea.local_id.length > 0, `${step}.ideas.local_id invalid`, { idea });
    assert(typeof idea.label === 'string' && idea.label.trim().length > 0, `${step}.ideas.label invalid`, { idea });
    assert(typeof idea.kind === 'string' && idea.kind.length > 0, `${step}.ideas.kind invalid`, { idea });
  }

  for (const event of result.events) {
    assert(typeof event.local_id === 'string' && event.local_id.length > 0, `${step}.events.local_id invalid`, { event });
    assert(typeof event.label === 'string' && event.label.trim().length > 0, `${step}.events.label invalid`, { event });
  }

  for (const entity of result.entities) {
    assert(typeof entity.local_id === 'string' && entity.local_id.length > 0, `${step}.entities.local_id invalid`, { entity });
    assert(typeof entity.label === 'string' && entity.label.trim().length > 0, `${step}.entities.label invalid`, { entity });
    assert(typeof entity.type === 'string' && entity.type.length > 0, `${step}.entities.type invalid`, { entity });
  }

  for (const theme of result.themes) {
    assert(typeof theme.local_id === 'string' && theme.local_id.length > 0, `${step}.themes.local_id invalid`, { theme });
    assert(typeof theme.label === 'string' && theme.label.trim().length > 0, `${step}.themes.label invalid`, { theme });
  }

  for (const relation of result.relations) {
    assert(typeof relation.local_id === 'string' && relation.local_id.length > 0, `${step}.relations.local_id invalid`, { relation });
    assert(typeof relation.from_id === 'string' && relation.from_id.length > 0, `${step}.relations.from_id invalid`, { relation });
    assert(typeof relation.to_id === 'string' && relation.to_id.length > 0, `${step}.relations.to_id invalid`, { relation });
    assert(typeof relation.from_type === 'string' && relation.from_type.length > 0, `${step}.relations.from_type invalid`, { relation });
    assert(typeof relation.to_type === 'string' && relation.to_type.length > 0, `${step}.relations.to_type invalid`, { relation });
    assert(typeof relation.relation_type === 'string' && relation.relation_type.length > 0, `${step}.relations.relation_type invalid`, { relation });
  }
}

function assert(condition, message, details) {
  if (!condition) {
    fail('assert', message, details);
  }
}

function assertWorkflowLinkage(step, scenario, upsert, submit, status, result, latest) {
  assert(status.workflowRunId === submit.workflowRunId, `${step}.status.workflowRunId mismatch`, {
    submit,
    status,
  });
  assert(status.status === 'completed', `${step}.status must be completed`, { status });
  assert(status.resultAvailable === true, `${step}.status.resultAvailable must be true`, { status });
  assert(status.bookId === scenario.bookId, `${step}.status.bookId mismatch`, { status });
  assert(status.chapterId === scenario.chapterId, `${step}.status.chapterId mismatch`, { status });
  assert(status.snapshotVersion === upsert.snapshotVersion, `${step}.status.snapshotVersion mismatch`, { upsert, status });
  assert(status.chapterContentHash === upsert.chapterContentHash, `${step}.status.chapterContentHash mismatch`, { upsert, status });

  assert(result.workflowRunId === submit.workflowRunId, `${step}.result.workflowRunId mismatch`, { submit, result });
  assert(result.bookId === scenario.bookId, `${step}.result.bookId mismatch`, { result });
  assert(result.chapterId === scenario.chapterId, `${step}.result.chapterId mismatch`, { result });
  assert(result.chapterIndex === scenario.chapterIndex, `${step}.result.chapterIndex mismatch`, { result });
  assert(result.snapshotVersion === upsert.snapshotVersion, `${step}.result.snapshotVersion mismatch`, { upsert, result });
  assert(result.chapterContentHash === upsert.chapterContentHash, `${step}.result.chapterContentHash mismatch`, { upsert, result });

  assert(latest.workflowRunId === submit.workflowRunId, `${step}.latest.workflowRunId mismatch`, { submit, latest });
  assert(latest.bookId === scenario.bookId, `${step}.latest.bookId mismatch`, { latest });
  assert(latest.chapterId === scenario.chapterId, `${step}.latest.chapterId mismatch`, { latest });
  assert(latest.chapterIndex === scenario.chapterIndex, `${step}.latest.chapterIndex mismatch`, { latest });
  assert(latest.snapshotVersion === upsert.snapshotVersion, `${step}.latest.snapshotVersion mismatch`, { upsert, latest });
  assert(latest.chapterContentHash === upsert.chapterContentHash, `${step}.latest.chapterContentHash mismatch`, { upsert, latest });
}

async function runManualScenario(baseUrl) {
  const scenario = buildScenario('manual');
  const idempotencyKey = `smoke-manual-${randomUUID()}`;
  logStep('manual.start', {
    bookId: scenario.bookId,
    chapterId: scenario.chapterId,
  });

  const upsert = await uploadPage(baseUrl, scenario);
  const submit = await submitWorkflow(baseUrl, scenario, upsert, idempotencyKey);
  const status = await pollWorkflowStatus(baseUrl, submit.workflowRunId);
  const result = await fetchWorkflowResult(baseUrl, submit.workflowRunId);
  const latest = await fetchLatestResult(baseUrl, scenario);

  assertWorkflowLinkage('manual', scenario, upsert, submit, status, result, latest);

  const deduped = await submitWorkflow(baseUrl, scenario, upsert, idempotencyKey);
  assert(deduped.workflowRunId === submit.workflowRunId, 'manual.dedupe.workflowRunId mismatch', {
    submit,
    deduped,
  });
  assert(deduped.deduped === true, 'manual.dedupe.deduped should be true', {
    deduped,
  });

  logStep('manual.success', {
    workflowRunId: submit.workflowRunId,
    snapshotVersion: upsert.snapshotVersion,
    chapterContentHash: upsert.chapterContentHash,
  });
}

async function runAutoScenario(baseUrl) {
  const scenario = buildScenario('auto');
  logStep('auto.start', {
    bookId: scenario.bookId,
    chapterId: scenario.chapterId,
  });

  const upsert = await uploadPage(baseUrl, scenario);
  const latest = await pollLatestResult(baseUrl, scenario);

  assert(latest.bookId === scenario.bookId, 'auto.latest.bookId mismatch', { latest, scenario });
  assert(latest.chapterId === scenario.chapterId, 'auto.latest.chapterId mismatch', { latest, scenario });
  assert(latest.chapterIndex === scenario.chapterIndex, 'auto.latest.chapterIndex mismatch', { latest, scenario });
  assert(latest.snapshotVersion === upsert.snapshotVersion, 'auto.latest.snapshotVersion mismatch', { upsert, latest });
  assert(latest.chapterContentHash === upsert.chapterContentHash, 'auto.latest.chapterContentHash mismatch', { upsert, latest });

  if (typeof latest.workflowRunId === 'string' && latest.workflowRunId.length > 0) {
    const status = await pollWorkflowStatus(baseUrl, latest.workflowRunId);
    assert(status.status === 'completed', 'auto.status must be completed', { status });
    assert(status.resultAvailable === true, 'auto.status.resultAvailable must be true', { status });

    const result = await fetchWorkflowResult(baseUrl, latest.workflowRunId);
    assert(result.workflowRunId === latest.workflowRunId, 'auto.result.workflowRunId mismatch', {
      latest,
      result,
    });
    assert(result.snapshotVersion === upsert.snapshotVersion, 'auto.result.snapshotVersion mismatch', {
      upsert,
      result,
    });
    assert(result.chapterContentHash === upsert.chapterContentHash, 'auto.result.chapterContentHash mismatch', {
      upsert,
      result,
    });
  }

  logStep('auto.success', {
    workflowRunId: latest.workflowRunId,
    snapshotVersion: upsert.snapshotVersion,
    chapterContentHash: upsert.chapterContentHash,
  });
}

async function main() {
  const baseUrl = requireLiveServerUrl();
  logStep('config', {
    liveServerUrl: baseUrl,
    validationMode: VALIDATION_MODE,
    pollIntervalMs: POLL_INTERVAL_MS,
    pollTimeoutMs: POLL_TIMEOUT_MS,
  });

  if (VALIDATION_MODE === 'manual' || VALIDATION_MODE === 'both') {
    await runManualScenario(baseUrl);
  }

  if (VALIDATION_MODE === 'auto' || VALIDATION_MODE === 'both') {
    await runAutoScenario(baseUrl);
  }

  logStep('success', { validationMode: VALIDATION_MODE });
}

main().catch((error) => {
  console.error('[smoke][failure]', error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
