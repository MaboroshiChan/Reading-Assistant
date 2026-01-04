// SentenceRelationship.tsx
import React from 'react';
import './SentenceRelationship.css';

interface SentenceRelationshipProps {
    prev_id: number; // id of previous sentence
    next_id: number; // id of next sentence
    prev: string; // relationship to previous sentence
    next: string; // relationship to next sentence
}

/** 
 * The Block and Arrow Rhetorical Map is a visual tool that treats sentences or ideas as functional "blocks"
 * connected by arrows that define their logical relationship (such as causality, contrast, or elaboration).
 */
const SentenceRelationship: React.FC<SentenceRelationshipProps> = ({
    prev_id,
    next_id,
    prev,
    next
}) => {
    return (
        <div className='sentence-relationship'>
            {prev && (
                <div className='relationship-connection prev'>
                    <span className='arrow'>&uarr;</span>
                    <span className='label'>{prev} <small>(from #{prev_id})</small></span>
                </div>
            )}
            {next && (
                <div className='relationship-connection next'>
                    <span className='label'>{next} <small>(to #{next_id})</small></span>
                    <span className='arrow'>&darr;</span>
                </div>
            )}
        </div>
    )
}

export default SentenceRelationship;