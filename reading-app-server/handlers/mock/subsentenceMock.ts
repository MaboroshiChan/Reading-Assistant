import type {
  AnalyzeSubSentenceData,
  SubSentenceAnalysisData,
  SubSentenceUnitData,
  RequestEnvelopeSubsentence,
} from '../../../reading-app/src/services/envelopes';

const createUnitId = (prefix: string, index: number): string => `${prefix}-${index.toString(36)}`;

export const buildMockSubSentenceData = (
  req: RequestEnvelopeSubsentence,
): AnalyzeSubSentenceData => {
  const sentenceId = req.payload.sentence_id;
  const span = req.payload.span;
  const text = req.meta && typeof (req.meta as Record<string, unknown>).fragment_text === 'string'
    ? ((req.meta as Record<string, unknown>).fragment_text as string)
    : req.meta && typeof (req.meta as Record<string, unknown>).sentence_text === 'string'
      ? ((req.meta as Record<string, unknown>).sentence_text as string).slice(span.start, span.end)
      : `fragment:${span.start}-${span.end}`;

  const tokens = text.split(/(,|;|\band\b|\bbut\b)/i).map(chunk => chunk.trim()).filter(Boolean);

  const units: SubSentenceUnitData[] = tokens.length
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

  const analysis: SubSentenceAnalysisData = {
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
