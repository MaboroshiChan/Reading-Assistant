import type Paragraph from '../model/structure/Paragraph';

/**
 * Groups paragraphs into batches whose combined word count stays within a limit.
 *
 * Each paragraph is still analyzed individually; the word limit only controls
 * how many paragraphs are fired concurrently per batch (via `Promise.all`).
 *
 * A single paragraph whose word count exceeds `maxWordsPerBatch` will be
 * placed in its own batch so it is never dropped.
 *
 * @param paragraphs  - Paragraph skeletons to partition.
 * @param maxWordsPerBatch - Approximate word-count ceiling for each batch.
 * @returns An array of paragraph batches.
 */
export function chunkParagraphsByWordCount(
    paragraphs: Paragraph[],
    maxWordsPerBatch: number,
): Paragraph[][] {
    const chunks: Paragraph[][] = [];
    let currentChunk: Paragraph[] = [];
    let currentWordCount = 0;

    for (const p of paragraphs) {
        const pText = p.sentences.map(s => s.text).join(' ').trim();
        const pWordCount = pText.length === 0 ? 0 : pText.split(/\s+/).length;

        if (currentWordCount + pWordCount > maxWordsPerBatch && currentChunk.length > 0) {
            chunks.push(currentChunk);
            currentChunk = [];
            currentWordCount = 0;
        }

        currentChunk.push(p);
        currentWordCount += pWordCount;
    }

    if (currentChunk.length > 0) {
        chunks.push(currentChunk);
    }

    return chunks;
}

/**
 * Checks if a paragraph is valid (ends with '.', '?', or '!') or if it is a title.
 * @param text - The paragraph text to check.
 * @returns True if valid or title, false otherwise.
 */
export function isValidParagraph(text: string): boolean {
    const trimmed = text.trim();
    if (trimmed.length === 0) return false;


    // Check if it's a regular paragraph (ends with punctuation)
    // OR matches: period + optional spaces + ( + text + ) + end of string
    const lastChar = trimmed[trimmed.length - 1];

    // 1. Standard ending
    if (['.', '?', '!', ':'].includes(lastChar)) {
        return true;
    }

    // 2. Parenthesis ending: "... . (Reference)"
    // Matches a period, optional whitespace, open paren, any text (non-greedy), close paren, end of string
    if (/\.\s*\(.*?\)$/.test(trimmed)) {
        return true;
    }

    // Check if it's a title
    return isTitle(text);
}

/**
 * Checks if a text block looks like a title.
 * Heuristic: Shorter than 20 words and does not end with terminal punctuation.
 * @param text - The text to check.
 * @returns True if it looks like a title.
 */
export function isTitle(text: string): boolean {
    const trimmed = text.trim();
    if (trimmed.length === 0) return false;

    const lastChar = trimmed[trimmed.length - 1];
    // Titles typically don't end with ., ?, or !
    if (['.', '?', '!', ':'].includes(lastChar)) {
        return false;
    }

    // Check word count
    const wordCount = trimmed.split(/\s+/).length;
    return wordCount <= 20;
}
