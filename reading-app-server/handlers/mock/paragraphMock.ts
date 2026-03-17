import type {
  AnalyzeParagraphData,
  ParagraphClaim,
  ParagraphRole,
  ParagraphRhetoric,
  RequestEnvelopeParagraph,
} from '../../../reading-app/src/services/envelopes';
import {
  makeAnchor,
  splitIntoSentences,
  summarize,
} from '../shared';
import { handlerLog } from '../logger';
import {
  buildParagraphPrompt,
  buildParagraphTasks,
  PARAGRAPH_PROMPT_VERSION,
  type ParagraphTask,
} from '../paragraph';

/**
 * Filters the mock results to only include requested task data.
 *
 * @param base - The full mock response.
 * @param tasks - List of requested tasks.
 * @returns The filtered response.
 */
const filterByTasks = (
  base: AnalyzeParagraphData,
  tasks?: ParagraphTask[],
): AnalyzeParagraphData => {
  if (!tasks || tasks.length === 0) return base;
  const requested = new Set(tasks);
  return {
    summary: requested.has('summary') ? base.summary : undefined,
    roles: requested.has('roles') ? base.roles : undefined,
    rhetoric: requested.has('rhetoric') ? base.rhetoric : undefined,
    claims: requested.has('claims') ? base.claims : undefined,
    tags: requested.has('tags') ? base.tags : undefined,
    anchors: base.anchors,
    confidence: base.confidence,
  };
};

/**
 * Generates mock paragraph analysis data.
 *
 * @param req - The request envelope.
 * @returns A promise resolving to mock AnalyzeParagraphData.
 */
export const buildMockParagraphData = async (
  req: RequestEnvelopeParagraph,
): Promise<AnalyzeParagraphData> => {
  const tasks = buildParagraphTasks(req);
  const prompt = await buildParagraphPrompt(req);
  handlerLog('paragraph', 'LLM prompt prepared', {
    requestId: req.request_id,
    paragraphId: req.payload.paragraph_id,
    promptVersion: PARAGRAPH_PROMPT_VERSION,
    tasks,
    promptLength: prompt.length,
    prompt,
    mock: true,
  });

  const text = req.payload.paragraph_text.trim();
  const fragments = splitIntoSentences(text);

  const paragraphAnchor = makeAnchor({
    paragraphId: req.payload.paragraph_id,
    span: { start: 0, end: text.length },
    text,
  });

  const roles: ParagraphRole[] = fragments.map((fragment, index) => ({
    role: index === 0 ? 'topic' : 'support',
    anchors: [
      makeAnchor({
        paragraphId: req.payload.paragraph_id,
        span: { start: fragment.start, end: fragment.end },
        text: fragment.text,
      }),
    ],
    confidence: index === 0 ? 0.7 : 0.5,
  }));

  const rhetoric: ParagraphRhetoric[] = [
    {
      label: text.includes('?') ? 'question' : 'statement',
      evidence_anchors: [paragraphAnchor],
      confidence: 0.5,
    },
  ];

  const claims: ParagraphClaim[] = [
    {
      text: fragments[0]?.text ?? text,
      polarity: 'pos',
      support: 'strong',
      anchors: fragments.slice(0, 1).map((fragment) =>
        makeAnchor({
          paragraphId: req.payload.paragraph_id,
          span: { start: fragment.start, end: fragment.end },
          text: fragment.text,
        }),
      ),
    },
  ];

  const base: AnalyzeParagraphData = {
    summary: summarize(text),
    roles,
    rhetoric,
    claims,
    anchors: [paragraphAnchor],
    tags: [
      { name: 'Introduction', type: 'logic', description: 'Sets up the context' },
      { name: 'Core Concept', type: 'concept', description: 'The main idea of the paragraph' }
    ],
    confidence: 0.6,
  };

  return filterByTasks(base, tasks);
};
