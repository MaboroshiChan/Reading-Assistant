import type {
  AnalyzeSkeletonData,
  RequestEnvelopeSkeleton,
  SkeletonParagraph,
  SkeletonSentence,
} from '../../../packages/contracts/src';
import { hashString, splitIntoSentences, summarize } from '../shared';

/**
 * Generates mock skeleton data (paragraphs and sentences) for a document.
 *
 * @param req - The request envelope.
 * @returns Mock AnalyzeSkeletonData.
 */
export const buildMockSkeletonData = (
  req: RequestEnvelopeSkeleton,
): AnalyzeSkeletonData => {
  const paragraphs: SkeletonParagraph[] = [];
  const sentences: SkeletonSentence[] = [];

  req.payload.sections.forEach((section, sectionIndex) => {
    const text = (section.text ?? '').trim();
    if (!text) return;

    const paragraphId = section.id || `section-${sectionIndex + 1}`;
    const fragments = splitIntoSentences(text);
    const sentenceIds: string[] = [];

    fragments.forEach((fragment, idx) => {
      const sentenceId = `${paragraphId}-s${idx + 1}`;
      sentenceIds.push(sentenceId);
      sentences.push({
        sentence_id: sentenceId,
        paragraph_id: paragraphId,
        text: fragment.text,
        text_hash: hashString(fragment.text),
        char_start: fragment.start,
        char_end: fragment.end,
      });
    });

    paragraphs.push({
      paragraph_id: paragraphId,
      text_hash: hashString(text),
      sentence_ids: sentenceIds,
      brief_summary: summarize(fragments[0]?.text ?? text, 200),
    });
  });

  const data: AnalyzeSkeletonData = {
    paragraphs,
    sentences,
  };

  if (req.payload.options?.max_entities && req.payload.options.max_entities > 0) {
    data.entity_index = Array.from({ length: Math.min(3, req.payload.options.max_entities) }).map((_, idx) => ({
      id: `entity-${idx + 1}`,
      type: 'TERM',
      canonical: `Mock Entity ${idx + 1}`,
      aliases: [],
      spans: [],
    }));
  }

  if (req.payload.options?.do_embeddings) {
    data.embeddings_meta = {
      dim: 768,
      chunking: 'sentence',
      index_id: `mock-index-${hashString(req.payload.doc_id).slice(0, 6)}`,
    };
  }

  return data;
};
