import React, { useMemo } from 'react';
import './css/Bridge.css';
import { getRelationConfig } from './Relations';

interface SentenceBridgeProps {
    type: string;
    isActive: boolean;
    onClick: (e: React.MouseEvent) => void;
}

/**
 * Renders a clickable "bridge" between two sentences that represents their logical relationship.
 *
 * @param props - Component properties.
 */
export const SentenceBridge: React.FC<SentenceBridgeProps> = ({ type, isActive, onClick }) => {
    const config = useMemo(() => getRelationConfig(type), [type]);

    return (
        <span className="sentence-bridge-container">
            <button
                className={`sentence-bridge ${isActive ? 'active' : ''}`}
                onClick={onClick}
                aria-label={`Relationship: ${config.label}`}
                title={isActive ? undefined : `Relationship: ${config.label}`}
                style={{ '--bridge-color': config.color } as React.CSSProperties}
            >
                <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                    {config.icon}
                </svg>
            </button>
            <div className={`sentence-bridge-bubble ${isActive ? 'visible' : ''}`}>
                {config.label}
            </div>
        </span>
    );
};
