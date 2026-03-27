import React from 'react';
import { WindowBase } from '../ui/WindowBase';
import type { UserProgress } from '../../hooks/useUserProgress';
import './css/MasteryWindow.css';

interface MasteryWindowProps {
    isOpen: boolean;
    onClose: () => void;
    userProgress: UserProgress | null;
}

export const MasteryWindow: React.FC<MasteryWindowProps> = ({ isOpen, onClose, userProgress }) => {
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
        <WindowBase isOpen={isOpen} onClose={onClose} title="Mastery 🎯">
            {userProgress ? (
                <div className="skills-panel-large">
                    <div className="skills-header-large">
                        <div className="skills-stat">Depth of Understanding: <span className="stat-highlight">{userProgress.depthOfUnderstanding}%</span></div>
                        <div className="skills-stat">XP: <span className="stat-highlight">{userProgress.exp}</span></div>
                    </div>
                    <div className="skills-title-large">Skills Breakdown</div>
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
            ) : (
                <div className="mastery-empty">
                    Complete some quizzes to build your Mastery!
                </div>
            )}
        </WindowBase>
    );
};
