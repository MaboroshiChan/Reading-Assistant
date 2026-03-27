import React from 'react';
import './css/FloatingMenu.css';
import type { UserProgress } from '../hooks/useUserProgress';

interface FloatingMenuProps {
    onQuizMeClick?: () => void;
    showNotification?: boolean;
    isGenerating?: boolean;
    hasError?: boolean;
    userProgress?: UserProgress;
}

export const FloatingMenu: React.FC<FloatingMenuProps> = ({ onQuizMeClick, showNotification, isGenerating, hasError, userProgress }) => {
    
    // helper to render blocks
    const renderSkillBar = (value: number) => {
        const blocks = Math.round(value / 10);
        return (
            <div className="skill-bar-visual">
                <span className="skill-blocks-filled">{'█'.repeat(blocks)}</span>
                <span className="skill-blocks-empty">{'░'.repeat(10 - blocks)}</span>
            </div>
        );
    };

    return (
        <aside className="floating-menu">
            {userProgress && (
                <div className="skills-panel">
                    <div className="skills-header">
                        <div className="skills-stat">Depth of Understanding: {userProgress.depthOfUnderstanding}%</div>
                        <div className="skills-stat">XP: {userProgress.exp}</div>
                    </div>
                    <div className="skills-title">Skills</div>
                    <div className="skills-list">
                        <div className="skill-row">
                            <span className="skill-label">Facts</span>
                            {renderSkillBar(userProgress.skills.Facts)}
                            <span className="skill-value">{userProgress.skills.Facts}</span>
                        </div>
                        <div className="skill-row">
                            <span className="skill-label">Inference</span>
                            {renderSkillBar(userProgress.skills.Inference)}
                            <span className="skill-value">{userProgress.skills.Inference}</span>
                        </div>
                        <div className="skill-row">
                            <span className="skill-label">Tone</span>
                            {renderSkillBar(userProgress.skills.Tone)}
                            <span className="skill-value">{userProgress.skills.Tone}</span>
                        </div>
                        <div className="skill-row">
                            <span className="skill-label">Argument</span>
                            {renderSkillBar(userProgress.skills.Argument)}
                            <span className="skill-value">{userProgress.skills.Argument}</span>
                        </div>
                    </div>
                </div>
            )}
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
