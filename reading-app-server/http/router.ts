import type {
  RequestEnvelope,
  ResponseEnvelope,
} from '../../reading-app/src/services/envelopes';
import { handleParagraph } from '../handlers/paragraph';
import { handleSentence } from '../handlers/sentence';
import { handleSkeleton } from '../handlers/skeleton';
import { handleSubSentence } from '../handlers/subsentence';
import { errorResponse, validateEnvelope } from './validate';

const UNKNOWN_REQUEST_ID = 'unknown';

const parseBody = (raw: string): { ok: true; value: unknown } | { ok: false; error: ResponseEnvelope } => {
  if (!raw || raw.trim() === '') {
    return {
      ok: false,
      error: errorResponse(
        UNKNOWN_REQUEST_ID,
        'E.BAD_REQUEST',
        400,
        'Request body cannot be empty',
      ),
    };
  }
  try {
    return { ok: true, value: JSON.parse(raw) };
  } catch (err) {
    return {
      ok: false,
      error: errorResponse(
        UNKNOWN_REQUEST_ID,
        'E.BAD_REQUEST',
        400,
        `Invalid JSON: ${(err as Error).message}`,
      ),
    };
  }
};

const dispatch = async (envelope: RequestEnvelope): Promise<ResponseEnvelope> => {
  if (envelope.type === 'analyze.skeleton.v1') {
    return handleSkeleton(envelope);
  }
  if (envelope.type === 'analyze.paragraph.v1') {
    return handleParagraph(envelope);
  }
  if (envelope.type === 'analyze.sentence.v1') {
    return handleSentence(envelope);
  }
  if (envelope.type === 'analyze.subsentence.v1') {
    return handleSubSentence(envelope);
  }
  const _exhaustive: never = envelope;
  return errorResponse(
    UNKNOWN_REQUEST_ID,
    'E.BAD_REQUEST',
    400,
    'Unsupported message type',
  );
};

export const handleMsg = async (raw: string): Promise<ResponseEnvelope> => {
  const parsed = parseBody(raw);
  if (!parsed.ok) return parsed.error;

  const validation = validateEnvelope(parsed.value);
  if (!validation.ok) return validation.error;

  try {
    return await dispatch(validation.envelope);
  } catch (error) {
    console.error('Handler error', error);
    return errorResponse(
      validation.envelope.request_id,
      'E.SERVER',
      500,
      error instanceof Error ? error.message : 'Unexpected server error',
    );
  }
};
