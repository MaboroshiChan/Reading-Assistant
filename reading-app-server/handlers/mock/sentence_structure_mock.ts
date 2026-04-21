import type {
  AnalyzeSentenceStructureData,
  SentenceStructureAnalysisData,
  SentenceStructureUnitData,
  RequestEnvelopeSentenceStructure,
} from '../../../packages/contracts/src';

const createUnitId = (prefix: string, index: number): string => `${prefix}-${index.toString(36)}`;

/**
 * Generates mock sentence structure analysis data.
 * Useful for frontend development without an active LLM backend.
 *
 * @param req - The request envelope.
 * @returns A mock AnalyzeSentenceStructureData object.
 */
export const buildMockSentenceStructureData = (
  req: RequestEnvelopeSentenceStructure,
): AnalyzeSentenceStructureData => {
  const sentenceId = req.payload.sentence_id;
  const span = req.payload.span;
  const text = req.meta && typeof (req.meta as Record<string, unknown>).fragment_text === 'string'
    ? ((req.meta as Record<string, unknown>).fragment_text as string)
    : req.meta && typeof (req.meta as Record<string, unknown>).sentence_text === 'string'
      ? ((req.meta as Record<string, unknown>).sentence_text as string).slice(span.start, span.end)
      : `fragment:${span.start}-${span.end}`;

  const tokens = text.split(/(,|;|\band\b|\bbut\b)/i).map(chunk => chunk.trim()).filter(Boolean);

  const units: SentenceStructureUnitData[] = tokens.length
    ? tokens.map((chunk, index) => ({
      id: createUnitId('mock', index + 1),
      text: chunk,
      role: index === 0 ? 'subject' : index === 1 ? 'predicate' : 'modifier',
      confidence: 0.5,
      source: 'model',
    }))
    : [{
      id: createUnitId('mock', 1),
      text,
      role: 'clause',
      confidence: 0.5,
      source: 'model',
    }];

  const analysis: SentenceStructureAnalysisData = {
    sentenceId,
    text,
    units,
    backbone: {
      subjectId: units[0]?.id,
      predicateId: units[1]?.id,
      objectId: units[2]?.id,
    },
    layoutHint: {
      highlightStrategy: 'semantic-role',
      showLabels: true,
    },
    meta: { generator: 'mock' },
  };

  return {
    analysis,
    confidence: 0.5,
  };
};
