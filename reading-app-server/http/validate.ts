import type {
  AnalyzeParagraphPayload,
  AnalyzeSentencePayload,
  AnalyzeSkeletonPayload,
  AnalyzeSentenceStructurePayload,
  ErrorCode,
  RequestEnvelope,
  RequestEnvelopeParagraph,
  RequestEnvelopeSentence,
  RequestEnvelopeSkeleton,
  RequestEnvelopeSentenceStructure,
  AnalyzeQuizPayload,
  RequestEnvelopeQuiz,
  ResponseEnvelope,
} from '../../reading-app/src/services/envelopes';

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null;

const isString = (value: unknown): value is string => typeof value === 'string';

const isNumber = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value);

/** Type guard for Skeleton analysis payload. */
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

/** Type guard for Paragraph analysis payload. */
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

/** Type guard for Sentence analysis payload. */
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

/** Type guard for Sentence Structure analysis payload. */
const isSentenceStructurePayload = (
  payload: unknown,
): payload is AnalyzeSentenceStructurePayload => {
  if (!isRecord(payload)) return false;
  if (!isString(payload.doc_id) || !isString(payload.sentence_id)) return false;
  if (!isRecord(payload.span)) return false;
  const { start, end } = payload.span as Record<string, unknown>;
  return isNumber(start) && isNumber(end) && start >= 0 && end >= start;
};

/** Type guard for Quiz analysis payload. */
const isQuizPayload = (
  payload: unknown,
): payload is AnalyzeQuizPayload => {
  if (!isRecord(payload)) return false;
  return (
    isString(payload.doc_id) &&
    isString(payload.article_text)
  );
};

/**
 * Helper to construct a ResponseEnvelope error.
 *
 * @param requestId - The request context ID.
 * @param code - Error category code.
 * @param http - HTTP status code.
 * @param message - Human-readable error message.
 * @returns A ResponseEnvelope with error status.
 */
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

/**
 * Validates a raw input object against the RequestEnvelope structure and specific payload type schemas.
 *
 * @param input - The raw object to validate.
 * @returns A ValidationResult indicating success (with envelope) or failure (with error).
 */
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
