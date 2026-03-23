import type { Sentence } from "./Sentence";
import { isTitle, isTooShortToAnalyze, isValidParagraph } from "../../utils/textUtils";

/** Represents a text paragraph with state and analysis results. */
export default interface Paragraph {
  id: number;
  sentences: Sentence[];

  status?: 'pending' | 'streaming' | 'complete' | 'error';
  errorMessage?: string;
  /** Kind of paragraph: regular text, a title/header, citation/note, or a short blurb not worth analyzing */
  kind?: 'text' | 'title' | 'citation' | 'short';

  /** Tags that capture the logic structure and key concepts of the paragraph */
  tags?: { name: string; type: 'logic' | 'concept'; description?: string }[];

  /** 可选：结构类型，如“并列”、“对比”、“递进”、“因果”等 */
  structureType?: 'Parallel' | 'Contrast' | 'Progression' | 'Causal' | 'Narrative' | string;

  /** 可选：段落整体功能，如“引入”、“论证”、“结论”等 */
  function?: 'Introduction' | 'Premise' | 'Conclusion' | 'Evidence' | string;

  /** The topic sentence of the paragraph if it has one */
  topicSentence?: {
    is_implicit?: boolean;
    text?: string;
    id?: string | number;
  };
}

/**
 * Creates a Paragraph model from raw text by performing local sentence splitting.
 *
 * @param text - The raw paragraph text.
 * @param id - The unique ID for this paragraph.
 * @returns A new Paragraph object with initial pending state.
 */
export const preprocessingFromText = (text: string, id: number): Paragraph => {
  const isTitleParagraph = isTitle(text);

  // Use shared validation logic
  // If it's not a title but is valid according to our rules, it's text
  const isRegularParagraph = !isTitleParagraph && isValidParagraph(text);

  // Classify kind
  let kind: 'text' | 'title' | 'citation' | 'short';
  if (isTitleParagraph) {
    kind = 'title';
  } else if (isRegularParagraph) {
    // Valid paragraph but too short / sparse to merit LLM analysis
    kind = isTooShortToAnalyze(text) ? 'short' : 'text';
  } else {
    kind = 'citation';
  }

  let rawSentences: string[] = [];

  // Use Intl.Segmenter if available for better sentence boundary detection
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  if (typeof Intl !== 'undefined' && (Intl as any).Segmenter) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const segmenter = new (Intl as any).Segmenter('en', { granularity: 'sentence' });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    for (const segment of segmenter.segment(text)) {
      rawSentences.push(segment.segment);
    }
  } else {
    // Fallback: Split by punctuation (.!?) followed by whitespace or end of string
    rawSentences = text.match(/[^.!?]+[.!?]+["']?|[^.!?]+$/g) || [text];
  }

  const sentences: Sentence[] = rawSentences
    .map((s) => s.trim())
    .filter((s) => s.length > 0)
    .map((s, index) => ({
      id: index + 1,
      text: s,
      // Default values for required fields (to be filled by analysis later)
      function: 'Pending',
      type: 'Declarative',
      purpose: '',
      mood: 'Indicative',
    }));

  return {
    id,
    sentences,
    // Only queue for analysis if it's a full-length text paragraph
    status: kind === 'text' ? 'pending' : 'complete',
    kind,
    function: kind === 'title' ? 'Title' : (kind === 'citation' ? 'Citation' : (kind === 'short' ? 'Short' : 'Pending')),
  };
};