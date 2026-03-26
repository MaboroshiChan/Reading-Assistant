import React from 'react';
import './css/FloatingMenu.css';

interface FloatingMenuProps {
    onQuizMeClick?: () => void;
    showNotification?: boolean;
    isGenerating?: boolean;
    hasError?: boolean;
}

export const FloatingMenu: React.FC<FloatingMenuProps> = ({ onQuizMeClick, showNotification, isGenerating, hasError }) => {
    return (
        <aside className="floating-menu">
            <ul className="floating-menu-list">
                <li className="floating-menu-item">
                    <button 
                        className={`floating-menu-button ${showNotification ? 'has-notification' : ''} ${isGenerating ? 'is-generating' : ''} ${hasError ? 'has-error' : ''}`} 
                        onClick={() => onQuizMeClick?.() || console.log('Quiz me clicked (not implemented)')}
                    >
                        <span className={`floating-menu-icon ${isGenerating ? 'pulse-icon' : ''}`}>
                            {isGenerating ? '✨' : hasError ? '❌' : '🎓'}
                        </span>
                        <span className="floating-menu-text">
                            {isGenerating ? 'Generating...' : hasError ? 'Quiz Failed' : 'Quiz me!'}
                        </span>
                    </button>
                </li>
            </ul>
        </aside>
    );
};
