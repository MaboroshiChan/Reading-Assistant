// SentenceRelationship.tsx
import React from 'react';
import './css/SentenceRelationship.css';


interface SentenceRelationshipProps {
    prev_id: number; // id of previous sentence
    next_id: number; // id of next sentence
    current_id: number; // id of current sentence
    prev: string; // relationship to previous sentence
    next: string; // relationship to next sentence
    onHoverSentence?: (id: number | null) => void;
}

/** 
 * The Block and Arrow Rhetorical Map is a visual tool that treats sentences or ideas as functional "blocks"
 * connected by arrows that define their logical relationship (such as causality, contrast, or elaboration).
 */
const SentenceRelationship: React.FC<SentenceRelationshipProps> = ({
    prev_id,
    next_id,
    current_id,
    prev,
    next,
    onHoverSentence
}) => {
    return (
        <div className='sentence-relationship'>
            {prev && (
                <>
                    <div 
                        className='node other'
                        onMouseEnter={() => onHoverSentence?.(prev_id)}
                        onMouseLeave={() => onHoverSentence?.(null)}
                    >#{prev_id}</div>
                    <div className='connector'>
                        <span className='connector-label'>{prev}</span>
                    </div>
                </>
            )}
            
            <div 
                className='node current'
                onMouseEnter={() => onHoverSentence?.(current_id)}
                onMouseLeave={() => onHoverSentence?.(null)}
            >#{current_id}</div>

            {next && (
                <>
                    <div className='connector'>
                        <span className='connector-label'>{next}</span>
                    </div>
                    <div 
                        className='node other'
                        onMouseEnter={() => onHoverSentence?.(next_id)}
                        onMouseLeave={() => onHoverSentence?.(null)}
                    >#{next_id}</div>
                </>
            )}
        </div>
    )
}

export default SentenceRelationship;