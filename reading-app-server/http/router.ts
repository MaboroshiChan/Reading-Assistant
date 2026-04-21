import type {
  RequestEnvelope,
  ResponseEnvelope,
} from '../../packages/contracts/src';
import type { CallReturn } from '../services/llmService';
import { handleParagraph } from '../handlers/paragraph';
import { handleSentence } from '../handlers/sentence';
import { handleSkeleton } from '../handlers/skeleton';
import { handleSentenceStructure } from '../handlers/sentence_structure';
import { handleQuiz } from '../handlers/quiz';
import { errorResponse, validateEnvelope } from './validate';

const UNKNOWN_REQUEST_ID = 'unknown';

/**
 * Parses the raw request body into a JSON object.
 *
 * @param raw - The raw body string.
 * @returns Object with either the parsed value or a ResponseEnvelope error.
 */
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

/**
 * Dispatches an envelope to the appropriate feature handler based on its type.
 *
 * @param envelope - The validated request envelope.
 * @returns A promise resolving to the response envelope (often streaming).
 */
const dispatch = async (envelope: RequestEnvelope): Promise<ResponseEnvelope> => {
  let result: CallReturn<string>;
  if (envelope.type === 'analyze.skeleton.v1') {
    result = await handleSkeleton(envelope);
  } else if (envelope.type === 'analyze.paragraph.v1') {
    result = await handleParagraph(envelope);
  } else if (envelope.type === 'analyze.sentence.v1') {
    result = await handleSentence(envelope);
  } else if (envelope.type === 'analyze.sentence-structure.v1') {
    console.log('handle sentence structure');
    result = await handleSentenceStructure(envelope);
  } else if (envelope.type === 'analyze.quiz.v1') {
    console.log('handle quiz');
    result = await handleQuiz(envelope);
  } else {
    const _exhaustive: never = envelope;
    return errorResponse(
      UNKNOWN_REQUEST_ID,
      'E.BAD_REQUEST',
      400,
      'Unsupported message type',
    );
  }

  return {
    request_id: envelope.request_id,
    status: 'ok',
    stream: result.data,
    usage: result.usage.then((u) => ({
      tokens_in: u.inputTokens,
      tokens_out: u.outputTokens,
      model_id: u.modelId,
    })),
  } as ResponseEnvelope;
};

/**
 * High-level handler for non-streaming messages (though the result may still be a stream).
 *
 * @param raw - The raw request body.
 * @returns A promise resolving to the response envelope.
 */
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

/**
 * High-level handler for streaming messages.
 *
 * @param raw - The raw request body.
 * @returns A promise resolving to the response envelope.
 */
export const handleStream = async (raw: string): Promise<ResponseEnvelope> => {
  const parsed = parseBody(raw);
  if (!parsed.ok) return parsed.error;

  const validation = validateEnvelope(parsed.value);
  if (!validation.ok) return validation.error;

  try {
    return await dispatch(validation.envelope);
  } catch (error) {
    return errorResponse(
      validation.envelope.request_id,
      'E.SERVER',
      500,
      error instanceof Error ? error.message : 'Unexpected server error',
    );
  }
};
