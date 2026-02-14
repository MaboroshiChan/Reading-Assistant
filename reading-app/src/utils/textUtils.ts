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
 * Checks if a paragraph is valid (ends with '.', '?', or '!').
 * TODO: Some 'paragraphs' that are not valid and contain a few words may be titles. Titles should be included but not analyzed.
 * To add this feature, it may involve modifying the Paragraph model 
 * to include a 'title' field and updating the isValidParagraph function to check for this field.
 * @param text - The paragraph text to check.
 * @returns True if valid, false otherwise.
 */
export function isValidParagraph(text: string): boolean {
    const trimmed = text.trim();
    if (trimmed.length === 0) return false;
    const lastChar = trimmed[trimmed.length - 1];
    return ['.', '?', '!'].includes(lastChar);
}
