import type {
  RequestEnvelope,
  ResponseEnvelope,
} from '../../reading-app/src/services/envelopes';
import type { CallReturn } from '../services/llmService';
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
  let result: CallReturn<string>;
  if (envelope.type === 'analyze.skeleton.v1') {
    result = await handleSkeleton(envelope);
  } else if (envelope.type === 'analyze.paragraph.v1') {
    result = await handleParagraph(envelope);
  } else if (envelope.type === 'analyze.sentence.v1') {
    result = await handleSentence(envelope);
  } else if (envelope.type === 'analyze.subsentence.v1') {
    console.log('handle subsentence');
    result = await handleSubSentence(envelope);
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

export const handleMsg = async (raw: string): Promise<ResponseEnvelope> => {
  const parsed = parseBody(raw);
  if (!parsed.ok) return parsed.error;

  const validation = validateEnvelope(parsed.value);
  if (!validation.ok) return validation.error;

  try {
    const result = await dispatch(validation.envelope);
    if (result.stream) {
      let text = '';
      for await (const chunk of result.stream) {
        text += chunk;
      }
      const data = JSON.parse(text);
      return {
        ...result,
        stream: undefined,
        data,
        usage: await result.usage,
      } as ResponseEnvelope;
    }
    return result;
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
