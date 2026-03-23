import React from 'react';
import './css/FloatingMenu.css';

interface FloatingMenuProps {
    onQuizMeClick?: () => void;
}

export const FloatingMenu: React.FC<FloatingMenuProps> = ({ onQuizMeClick }) => {
    return (
        <aside className="floating-menu">
            <ul className="floating-menu-list">
                <li className="floating-menu-item">
                    <button className="floating-menu-button" onClick={() => onQuizMeClick?.() || console.log('Quiz me clicked (not implemented)')}>
                        <span className="floating-menu-icon">🎓</span>
                        <span className="floating-menu-text">Quiz me!</span>
                    </button>
                </li>
            </ul>
        </aside>
    );
};
