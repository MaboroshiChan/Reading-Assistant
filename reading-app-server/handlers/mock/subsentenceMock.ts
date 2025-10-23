import type {
  AnalyzeSubSentenceData,
  ContrastResolution,
  CueInteraction,
  MicroRole,
  RequestEnvelopeSubsentence,
} from '../../../reading-app/src/services/envelopes';
import { clampSpan, makeAnchor } from '../shared';

const detectCueInteraction = (
  snippet: string,
  spanStart: number,
  spanEnd: number,
): CueInteraction => {
  const cues: string[] = [];
  const lowered = snippet.toLowerCase();
  const cueWords = ['because', 'however', 'although', 'therefore', 'but'];
  cueWords.forEach((cue) => {
    if (lowered.includes(cue)) cues.push(cue);
  });

  const relation = cues.includes('but') || cues.includes('however')
    ? 'contrast'
    : cues.includes('because')
      ? 'causal'
      : 'detail';

  return {
    cues,
    relation,
    scope: { start: spanStart, end: spanEnd },
  };
};

const detectContrast = (sentence: string | undefined): ContrastResolution | undefined => {
  if (!sentence) return undefined;
  const lowered = sentence.toLowerCase();
  const idx = lowered.indexOf(' but ');
  if (idx === -1) return undefined;
  return {
    a_span: { start: 0, end: idx },
    b_span: { start: idx + 5, end: sentence.length },
    relation: 'contrast',
  };
};

const filterByTasks = (
  base: AnalyzeSubSentenceData,
  tasks?: Array<'micro_roles' | 'cue_interaction' | 'contrast_resolution'>,
): AnalyzeSubSentenceData => {
  if (!tasks || tasks.length === 0) return base;
  const requested = new Set(tasks);
  return {
    micro_roles: requested.has('micro_roles') ? base.micro_roles : undefined,
    cue_interaction: requested.has('cue_interaction') ? base.cue_interaction : undefined,
    contrast_resolution: requested.has('contrast_resolution') ? base.contrast_resolution : undefined,
    anchors: base.anchors,
    confidence: base.confidence,
  };
};

export const buildMockSubSentenceData = (
  req: RequestEnvelopeSubsentence,
): AnalyzeSubSentenceData => {
  const { span } = req.payload;
  const boundedSpan = clampSpan(span, 0);
  const meta = req.meta as Record<string, unknown> | undefined;
  const sentenceText = typeof meta?.sentence_text === 'string' ? (meta.sentence_text as string) : '';
  const explicitFragment = typeof meta?.fragment_text === 'string' ? (meta.fragment_text as string) : undefined;
  const text =
    explicitFragment ??
    (sentenceText
      ? sentenceText.slice(boundedSpan.start, boundedSpan.end)
      : `span:${boundedSpan.start}-${boundedSpan.end}`);
  const anchor = makeAnchor({
    sentenceId: req.payload.sentence_id,
    span: boundedSpan,
    text,
  });

  const micro_roles: MicroRole[] = text
    ? [
        {
          label: text.includes(',') ? 'clause' : 'focus',
          anchors: [anchor],
          confidence: 0.6,
        },
      ]
    : [];

  const cue_interaction = detectCueInteraction(
    text,
    boundedSpan.start,
    boundedSpan.end,
  );

  const contrast_resolution = detectContrast(sentenceText);

  const base: AnalyzeSubSentenceData = {
    micro_roles,
    cue_interaction,
    contrast_resolution,
    anchors: [anchor],
    confidence: micro_roles.length ? 0.6 : 0.4,
  };

  return filterByTasks(base, req.payload.options?.tasks);
};
