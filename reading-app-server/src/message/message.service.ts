import { Injectable } from '@nestjs/common';
import type {
  RequestEnvelope,
  ResponseEnvelope,
} from '../../../packages/contracts/src';
import type { CallReturn } from '../../services/llmService';
import { handleParagraph } from '../../handlers/paragraph';
import { handleSentence } from '../../handlers/sentence';
import { handleSkeleton } from '../../handlers/skeleton';
import { handleSentenceStructure } from '../../handlers/sentence_structure';
import { handleQuiz } from '../../handlers/quiz';
import { handleKnowledgeExtraction } from '../../handlers/knowledge_extraction';
import { errorResponse, validateEnvelope } from '../../../packages/contracts/src';

const UNKNOWN_REQUEST_ID = 'unknown';

const parseBody = (
  raw: string,
): { ok: true; value: unknown } | { ok: false; error: ResponseEnvelope } => {
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
  } catch (error) {
    return {
      ok: false,
      error: errorResponse(
        UNKNOWN_REQUEST_ID,
        'E.BAD_REQUEST',
        400,
        `Invalid JSON: ${(error as Error).message}`,
      ),
    };
  }
};

export const dispatchEnvelope = async (envelope: RequestEnvelope): Promise<ResponseEnvelope> => {
  let result: CallReturn<string>;

  switch (envelope.type) {
    case 'analyze.skeleton.v1':
      result = await handleSkeleton(envelope);
      break;
    case 'analyze.paragraph.v1':
      result = await handleParagraph(envelope);
      break;
    case 'analyze.sentence.v1':
      result = await handleSentence(envelope);
      break;
    case 'analyze.sentence-structure.v1':
      result = await handleSentenceStructure(envelope);
      break;
    case 'analyze.quiz.v1':
      result = await handleQuiz(envelope);
      break;
    case 'analyze.knowledge-extraction.v1':
      result = await handleKnowledgeExtraction(envelope);
      break;
    default: {
      const exhaustive: never = envelope;
      void exhaustive;
      return errorResponse(
        UNKNOWN_REQUEST_ID,
        'E.BAD_REQUEST',
        400,
        'Unsupported message type',
      );
    }
  }

  return {
    request_id: envelope.request_id,
    status: 'ok',
    stream: result.data,
    usage: result.usage.then((usage) => ({
      tokens_in: usage.inputTokens,
      tokens_out: usage.outputTokens,
      model_id: usage.modelId,
    })),
  } as ResponseEnvelope;
};

const handleRawEnvelope = async (raw: string): Promise<ResponseEnvelope> => {
  const parsed = parseBody(raw);
  if (!parsed.ok) return parsed.error;

  const validation = validateEnvelope(parsed.value);
  if (!validation.ok) return validation.error;

  try {
    return await dispatchEnvelope(validation.envelope);
  } catch (error) {
    return errorResponse(
      validation.envelope.request_id,
      'E.SERVER',
      500,
      error instanceof Error ? error.message : 'Unexpected server error',
    );
  }
};

export const handleRawMessage = async (raw: string): Promise<ResponseEnvelope> =>
  handleRawEnvelope(raw);

export const handleRawStream = async (raw: string): Promise<ResponseEnvelope> =>
  handleRawEnvelope(raw);

@Injectable()
export class MessageService {
  handleMsg(raw: string): Promise<ResponseEnvelope> {
    return handleRawMessage(raw);
  }

  handleStream(raw: string): Promise<ResponseEnvelope> {
    return handleRawStream(raw);
  }
}
