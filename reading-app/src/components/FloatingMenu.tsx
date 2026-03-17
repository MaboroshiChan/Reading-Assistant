import React from 'react';
import './css/FloatingMenu.css';

interface FloatingMenuProps {
    // We can add props here later if needed (e.g., onQuizMeClick)
}

export const FloatingMenu: React.FC<FloatingMenuProps> = () => {
    return (
        <aside className="floating-menu">
            <ul className="floating-menu-list">
                <li className="floating-menu-item">
                    <button className="floating-menu-button" onClick={() => console.log('Quiz me clicked (not implemented)')}>
                        <span className="floating-menu-icon">🎓</span>
                        <span className="floating-menu-text">Quiz me!</span>
                    </button>
                </li>
            </ul>
        </aside>
    );
};
