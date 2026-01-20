import React, { useEffect, useState, useRef } from 'react';
import './css/ParagraphGutter.css';

export interface ParagraphGutterProps {
    id: number;
    structureType?: string;
    status?: 'pending' | 'streaming' | 'complete' | 'error';
    isActive: boolean;
    onClick: (e: React.MouseEvent) => void;
}

/**
 * Maps a paragraph structure type to a specific theme color.
 *
 * @param type - The structure type string (e.g., "Contrast", "Causal").
 * @returns A CSS variable name or color value.
 */
const getGutterColor = (type?: string) => {
    if (!type) return 'var(--color-surface-border)';
    const t = type.toLowerCase();
    if (t.includes('contrast')) return 'var(--color-status-red)';
    if (t.includes('parallel')) return 'var(--color-status-blue)';
    if (t.includes('progression') || t.includes('sequence')) return 'var(--color-status-yellow)';
    if (t.includes('causal')) return 'var(--color-primary)';
    return 'var(--color-status-green)';
};

/** Loading spinner for the gutter indicator. */
const Spinner = () => (
    <svg className="paragraph-spinner" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
        <circle className="paragraph-spinner-circle" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
        <path className="paragraph-spinner-path" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
    </svg>
);

/** Success checkmark for the gutter indicator. */
const CheckMark = () => (
    <svg className="paragraph-check" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
    </svg>
);

/**
 * Renders the vertical gutter for a paragraph, showing its status and structure type.
 *
 * @param props - Component properties.
 */
export const ParagraphGutter: React.FC<ParagraphGutterProps> = ({
    id,
    structureType,
    status = 'complete', // Default to complete if not provided
    isActive,
    onClick
}) => {
    const color = getGutterColor(structureType);
    const [showSuccess, setShowSuccess] = useState(false);
    const prevStatus = useRef(status);

    // Effect to show success checkmark briefly when switching from pending/streaming to complete
    useEffect(() => {
        const wasPending = prevStatus.current === 'pending' || prevStatus.current === 'streaming';
        const isComplete = status === 'complete';

        if (wasPending && isComplete) {
            setShowSuccess(true);
            const timer = setTimeout(() => setShowSuccess(false), 2000); // Show check for 2s
            return () => clearTimeout(timer);
        }
        prevStatus.current = status;
    }, [status]);

    let indicator;
    if (status === 'pending' || status === 'streaming') {
        indicator = <Spinner />;
    } else if (showSuccess) {
        indicator = <div className="paragraph-gutter-indicator success"><CheckMark /></div>;
    } else if (status === 'error') {
        indicator = <div className="paragraph-gutter-indicator error">!</div>;
    } else {
        // Default state: just the ID or potentially nothing if we want it very clean
        indicator = id;
    }

    return (
        <div className="paragraph-gutter-container">
            <div
                className={`paragraph-gutter-indicator ${isActive ? 'active' : ''}`}
                title={structureType || `Paragraph ${id}`}
                onClick={onClick}
                style={{
                    '--gutter-color': structureType ? color : undefined,
                    cursor: 'pointer'
                } as React.CSSProperties}
            >
                {indicator}
            </div>
        </div>
    );
};
