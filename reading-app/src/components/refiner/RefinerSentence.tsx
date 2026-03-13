import React, { useMemo } from 'react';
import './RefinerSentence.css';

interface RefinerSentenceProps {
    text: string;
    keyWords: string;
    isEditable: boolean;
    onKeyWordsChange?: (newKeyWords: string) => void;
}

/**
 * Normalizes keywords to match correctly regardless of padding whitespace.
 */
const parseKeywords = (kwStr: string): string[] => {
    if (!kwStr) return [];
    return kwStr.split(',').map(s => s.trim()).filter(s => s.length > 0);
};

/**
 * A specialized Sentence component for visual prompt refinement.
 * Automatically parses the comma-separated keywords and highlights them.
 * If isEditable, clicking words toggles their inclusion in the `keyWords` prop.
 */
export const RefinerSentence: React.FC<RefinerSentenceProps> = ({
    text,
    keyWords,
    isEditable,
    onKeyWordsChange,
}) => {
    // Convert comma-separated string to an array of trimmed terms
    const highlightTerms = useMemo(() => parseKeywords(keyWords), [keyWords]);

    // Handle toggling a word in the manual selection list
    const handleTokenClick = (wordOrPhrase: string) => {
        if (!isEditable || !onKeyWordsChange) return;

        const term = wordOrPhrase.trim();
        if (!term) return;

        let updatedList = [...highlightTerms];

        // Simple toggle: If exact match exists, remove it. Otherwise add it.
        if (updatedList.includes(term)) {
            updatedList = updatedList.filter(t => t !== term);
        } else {
            updatedList.push(term);
        }

        onKeyWordsChange(updatedList.join(', '));
    };

    /**
     * If editable, we want to split the text into completely clickable words and punctuation
     * so the user can easily select individual words.
     * If NOT editable, we just use the highlight terms to chunk it up (similar to standard Sentence.tsx).
     */
    const renderTokens = () => {
        if (isEditable) {
            // Split by word boundaries or spaces to make everything a clickable token
            const tokens = text.match(/[\w'-]+|[.,!?;:()]+|\s+/g) || [text];

            return tokens.map((token, idx) => {
                // We only care about non-whitespace tokens for highlighting
                const isWhitespace = /^\s+$/.test(token);

                let isHighlighted = false;
                if (!isWhitespace) {
                    // Check if this token is wholly part of any highlight term 
                    // OR if a highlight term exactly matches this token.
                    // A more complex matching might be needed for multi-word phrases, 
                    // but for simple token toggles this works well.
                    isHighlighted = highlightTerms.some(ht => {
                        const tokenStr = token.trim();
                        if (ht === tokenStr) return true;

                        // If it's a multi-word phrase, we check if this token is one of the exact words
                        // We use the same regex used to split the text to ensure consistency
                        const htWords: string[] = ht.match(/[\w'-]+|[.,!?;:()]+/g) || [];
                        return htWords.includes(tokenStr);
                    });
                }

                const className = `refiner-token ${isWhitespace ? 'whitespace' : 'interactive'} ${isHighlighted ? 'active' : ''}`;

                return (
                    <span
                        key={idx}
                        className={className}
                        onClick={() => !isWhitespace && handleTokenClick(token)}
                        title={!isWhitespace ? "Click to toggle highlight" : undefined}
                    >
                        {token}
                    </span>
                );
            });
        }

        // --- Read-Only Rendering (Uses Regex Splitting based on the given keywords) ---
        if (highlightTerms.length === 0) {
            return <span>{text}</span>;
        }

        try {
            // Escape special chars for regex
            const escapeRegExp = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

            // Match multi-word phrases and single words
            // Sort by length descending so longer phrases match before their sub-words
            const sortedTerms = [...highlightTerms].sort((a, b) => b.length - a.length);
            const pattern = new RegExp(`\\b(${sortedTerms.map(escapeRegExp).join('|')})\\b`, 'g');
            const parts = text.split(pattern);

            return parts.map((part, index) => {
                if (highlightTerms.includes(part)) {
                    return (
                        <span key={index} className="refiner-highlight">
                            {part}
                        </span>
                    );
                }
                return <React.Fragment key={index}>{part}</React.Fragment>;
            });
        } catch {
            return <span>{text}</span>;
        }
    };

    return (
        <div className={`refiner-sentence ${isEditable ? 'editable' : ''}`}>
            {renderTokens()}
        </div>
    );
};

export default RefinerSentence;
