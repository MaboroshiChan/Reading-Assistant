import type {
  AnalyzeKnowledgeExtractionPayload,
  AnalyzeParagraphPayload,
  AnalyzeQuizPayload,
  AnalyzeSentencePayload,
  AnalyzeSentenceStructurePayload,
  AnalyzeSkeletonPayload,
  ErrorCode,
  RequestEnvelope,
  RequestEnvelopeParagraph,
  RequestEnvelopeQuiz,
  RequestEnvelopeKnowledgeExtraction,
  RequestEnvelopeSentence,
  RequestEnvelopeSentenceStructure,
  RequestEnvelopeSkeleton,
  ResponseEnvelope,
} from './envelopes';

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null;

const isString = (value: unknown): value is string => typeof value === 'string';

const isNumber = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value);

const isSkeletonPayload = (
  payload: unknown,
): payload is AnalyzeSkeletonPayload => {
  if (!isRecord(payload)) return false;
  if (!isString(payload.doc_id)) return false;
  if (!isString(payload.content_hash)) return false;
  if (!Array.isArray(payload.sections)) return false;
  return payload.sections.every(
    (section) =>
      isRecord(section) &&
      isString(section.id) &&
      isString(section.text),
  );
};

const isParagraphPayload = (
  payload: unknown,
): payload is AnalyzeParagraphPayload => {
  if (!isRecord(payload)) return false;
  return (
    isString(payload.doc_id) &&
    isString(payload.paragraph_id) &&
    isString(payload.paragraph_text)
  );
};

const isSentencePayload = (
  payload: unknown,
): payload is AnalyzeSentencePayload => {
  if (!isRecord(payload)) return false;
  return (
    isString(payload.doc_id) &&
    isString(payload.sentence_id) &&
    isString(payload.sentence_text)
  );
};

const isSentenceStructurePayload = (
  payload: unknown,
): payload is AnalyzeSentenceStructurePayload => {
  if (!isRecord(payload)) return false;
  if (!isString(payload.doc_id) || !isString(payload.sentence_id)) return false;
  if (!isRecord(payload.span)) return false;
  const { start, end } = payload.span as Record<string, unknown>;
  return isNumber(start) && isNumber(end) && start >= 0 && end >= start;
};

const isQuizPayload = (
  payload: unknown,
): payload is AnalyzeQuizPayload => {
  if (!isRecord(payload)) return false;
  return (
    isString(payload.doc_id) &&
    isString(payload.article_text)
  );
};

const isKnowledgeExtractionPayload = (
  payload: unknown,
): payload is AnalyzeKnowledgeExtractionPayload => {
  if (!isRecord(payload)) return false;
  return (
    isString(payload.doc_id) &&
    isString(payload.chapter_id) &&
    isString(payload.chapter_text)
  );
};

const makeError = (
  requestId: string,
  code: ErrorCode,
  http: number,
  message: string,
): ResponseEnvelope =>
  ({
    request_id: requestId,
    status: 'error',
    error: {
      code,
      http,
      message,
    },
  }) as ResponseEnvelope;

export type ValidationResult =
  | { ok: true; envelope: RequestEnvelope }
  | { ok: false; error: ResponseEnvelope };

export const validateEnvelope = (input: unknown): ValidationResult => {
  if (!isRecord(input)) {
    return {
      ok: false,
      error: makeError(
        'unknown',
        'E.BAD_REQUEST',
        400,
        'Request body must be a JSON object',
      ),
    };
  }

  const { type, request_id: requestId, payload } = input;

  if (!isString(type)) {
    return {
      ok: false,
      error: makeError(
        'unknown',
        'E.BAD_REQUEST',
        400,
        'Missing or invalid "type"',
      ),
    };
  }

  if (!isString(requestId)) {
    return {
      ok: false,
      error: makeError(
        'unknown',
        'E.BAD_REQUEST',
        400,
        'Missing or invalid "request_id"',
      ),
    };
  }

  if (!payload) {
    return {
      ok: false,
      error: makeError(
        requestId,
        'E.BAD_REQUEST',
        400,
        'Missing "payload"',
      ),
    };
  }

  switch (type) {
    case 'analyze.skeleton.v1':
      if (!isSkeletonPayload(payload)) {
        return {
          ok: false,
          error: makeError(
            requestId,
            'E.BAD_REQUEST',
            400,
            'Invalid skeleton payload',
          ),
        };
      }
      return {
        ok: true,
        envelope: input as unknown as RequestEnvelopeSkeleton,
      };

    case 'analyze.paragraph.v1':
      if (!isParagraphPayload(payload)) {
        return {
          ok: false,
          error: makeError(
            requestId,
            'E.BAD_REQUEST',
            400,
            'Invalid paragraph payload',
          ),
        };
      }
      return {
        ok: true,
        envelope: input as unknown as RequestEnvelopeParagraph,
      };

    case 'analyze.sentence.v1':
      if (!isSentencePayload(payload)) {
        return {
          ok: false,
          error: makeError(
            requestId,
            'E.BAD_REQUEST',
            400,
            'Invalid sentence payload',
          ),
        };
      }
      return {
        ok: true,
        envelope: input as unknown as RequestEnvelopeSentence,
      };

    case 'analyze.sentence-structure.v1':
      if (!isSentenceStructurePayload(payload)) {
        return {
          ok: false,
          error: makeError(
            requestId,
            'E.BAD_REQUEST',
            400,
            'Invalid sentence structure payload',
          ),
        };
      }
      return {
        ok: true,
        envelope: input as unknown as RequestEnvelopeSentenceStructure,
      };

    case 'analyze.quiz.v1':
      if (!isQuizPayload(payload)) {
        return {
          ok: false,
          error: makeError(
            requestId,
            'E.BAD_REQUEST',
            400,
            'Invalid quiz payload',
          ),
        };
      }
      return {
        ok: true,
        envelope: input as unknown as RequestEnvelopeQuiz,
      };

    case 'analyze.knowledge-extraction.v1':
      if (!isKnowledgeExtractionPayload(payload)) {
        return {
          ok: false,
          error: makeError(
            requestId,
            'E.BAD_REQUEST',
            400,
            'Invalid knowledge extraction payload',
          ),
        };
      }
      return {
        ok: true,
        envelope: input as unknown as RequestEnvelopeKnowledgeExtraction,
      };

    default:
      return {
        ok: false,
        error: makeError(
          requestId,
          'E.BAD_REQUEST',
          400,
          `Unsupported message type "${type}"`,
        ),
      };
  }
};

export const errorResponse = makeError;
