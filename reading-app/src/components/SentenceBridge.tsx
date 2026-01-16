import React, { useMemo } from 'react';
import './css/SentenceBridge.css';

interface SentenceBridgeProps {
    type: string;
    isActive: boolean;
    onClick: (e: React.MouseEvent) => void;
}

// Icons mapping based on Relation Type
const getIconPath = (type: string) => {
    const t = type.toLowerCase();

    // Contrast / Rebuttal -> Arrows Opposing
    if (t.includes('contrast') || t.includes('rebuttal')) {
        return <path d="M7 16V4M7 4L3 8M7 4L11 8M17 8v12M17 20l-4-4M17 20l4-4" strokeLinecap="round" strokeLinejoin="round" />;
    }

    // Conclusion / Result -> Right Arrow (implied result) or Therefore dots
    if (t.includes('conclusion')) {
        // Therefore symbol (dots)
        return (
            <>
                <circle cx="12" cy="7" r="2" fill="currentColor" stroke="none" />
                <circle cx="7" cy="17" r="2" fill="currentColor" stroke="none" />
                <circle cx="17" cy="17" r="2" fill="currentColor" stroke="none" />
            </>
        );
    }

    // Justification -> Because (Inverted Therefore)
    if (t.includes('justification')) {
        // Because symbol
        return (
            <>
                <circle cx="7" cy="7" r="2" fill="currentColor" stroke="none" />
                <circle cx="17" cy="7" r="2" fill="currentColor" stroke="none" />
                <circle cx="12" cy="17" r="2" fill="currentColor" stroke="none" />
            </>
        );
    }

    // Elaboration / Expansion -> Plus or Flow
    if (t.includes('elaboration') || t.includes('expansion')) {
        return <path d="M12 5v14M5 12h14" strokeLinecap="round" strokeLinejoin="round" />;
    }

    // Default -> Simple Link/Chain
    return <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" strokeLinecap="round" strokeLinejoin="round" />;
};

export const SentenceBridge: React.FC<SentenceBridgeProps> = ({ type, isActive, onClick }) => {
    const icon = useMemo(() => getIconPath(type), [type]);

    return (
        <span className="sentence-bridge-container">
            <button
                className={`sentence-bridge ${isActive ? 'active' : ''}`}
                onClick={onClick}
                aria-label={`Relationship: ${type}`}
                title={isActive ? undefined : `Relationship: ${type}`} // Native tooltip as fallback
            >
                <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                    {icon}
                </svg>
            </button>
            <div className={`sentence-bridge-bubble ${isActive ? 'visible' : ''}`}>
                {type}
            </div>
        </span>
    );
};
