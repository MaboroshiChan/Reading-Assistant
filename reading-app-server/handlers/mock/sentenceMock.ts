import type {
  AnalyzeSentenceData,
  DependencyArc,
  ModalMarker,
  RequestEnvelopeSentence,
  SentenceRole,
} from '../../../reading-app/src/services/envelopes';
import { makeAnchor, tokenize } from '../shared';
import { handlerLog } from '../logger';
import {
  buildSentencePrompt,
  buildSentenceTasks,
  SENTENCE_PROMPT_VERSION,
} from '../sentence';

const modalMap: Record<string, ModalMarker['type']> = {
  must: 'necessity',
  should: 'necessity',
  shall: 'necessity',
  could: 'possibility',
  might: 'possibility',
  may: 'possibility',
  can: 'possibility',
  will: 'certainty',
  would: 'volition',
};

const filterByTasks = (
  base: AnalyzeSentenceData,
  tasks?: Array<'semantic_roles' | 'key_words' | 'discourse_function' | 'dependency_light' | 'modal_markers'>,
): AnalyzeSentenceData => {
  if (!tasks || tasks.length === 0) return base;
  const requested = new Set(tasks);
  return {
    semantic_roles: requested.has('semantic_roles') ? base.semantic_roles : undefined,
    key_words: requested.has('key_words') ? base.key_words : undefined,
    discourse_function: requested.has('discourse_function') ? base.discourse_function : undefined,
    dependency_light: requested.has('dependency_light') ? base.dependency_light : undefined,
    modal_markers: requested.has('modal_markers') ? base.modal_markers : undefined,
    anchors: base.anchors,
    confidence: base.confidence,
  };
};

export const buildMockSentenceData = async (
  req: RequestEnvelopeSentence,
): Promise<AnalyzeSentenceData> => {
  const tasks = buildSentenceTasks(req);
  const prompt = await buildSentencePrompt(req);
  handlerLog('sentence', 'LLM prompt prepared', {
    requestId: req.request_id,
    sentenceId: req.payload.sentence_id,
    promptVersion: SENTENCE_PROMPT_VERSION,
    tasks,
    promptLength: prompt.length,
    prompt,
    mock: true,
  });

  const text = req.payload.sentence_text.trim();
  const tokens = tokenize(text);

  const sentenceAnchor = makeAnchor({
    sentenceId: req.payload.sentence_id,
    span: { start: 0, end: text.length },
    text,
  });

  const semantic_roles: SentenceRole[] = [];

  if (tokens[0]) {
    semantic_roles.push({
      role: 'subject',
      span: { start: tokens[0].start, end: tokens[0].end },
      anchors: [
        makeAnchor({
          sentenceId: req.payload.sentence_id,
          span: { start: tokens[0].start, end: tokens[0].end },
          text: tokens[0].token,
        }),
      ],
      confidence: 0.6,
    });
  }

  if (tokens[1]) {
    semantic_roles.push({
      role: 'predicate',
      span: { start: tokens[1].start, end: tokens[1].end },
      anchors: [
        makeAnchor({
          sentenceId: req.payload.sentence_id,
          span: { start: tokens[1].start, end: tokens[1].end },
          text: tokens[1].token,
        }),
      ],
      confidence: 0.55,
    });
  }

  if (tokens.length > 2) {
    const last = tokens[tokens.length - 1];
    semantic_roles.push({
      role: 'object',
      span: { start: last.start, end: last.end },
      anchors: [
        makeAnchor({
          sentenceId: req.payload.sentence_id,
          span: { start: last.start, end: last.end },
          text: last.token,
        }),
      ],
      confidence: 0.5,
    });
  }

  const arcs: DependencyArc[] = tokens.slice(1).map((token, index) => ({
    head: 0,
    dep: index + 1,
    label: index === 0 ? 'root' : 'modifier',
  }));

  const modal_markers: ModalMarker[] = tokens
    .map((token) => {
      const mapped = modalMap[token.token.toLowerCase()];
      if (!mapped) return null;
      return {
        type: mapped,
        span: { start: token.start, end: token.end },
        cue: token.token,
      };
    })
    .filter((marker): marker is ModalMarker => marker !== null);

  const discourse_function = (() => {
    const lowered = text.toLowerCase();
    if (lowered.includes('because')) return 'support';
    if (lowered.includes('however') || lowered.includes('but')) return 'contrast';
    if (text.endsWith('?')) return 'question';
    return 'statement';
  })();

  const base: AnalyzeSentenceData = {
    semantic_roles,
    discourse_function,
    dependency_light: {
      head_indexed: true,
      arcs,
    },
    modal_markers: modal_markers.length ? modal_markers : undefined,
    anchors: [
      sentenceAnchor,
      ...semantic_roles.flatMap((role) => role.anchors ?? []),
    ],
    confidence: Math.min(0.9, 0.4 + tokens.length * 0.05),
  };

  return filterByTasks(base, tasks);
};
