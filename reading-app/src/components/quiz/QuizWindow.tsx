import React from 'react';
import { WindowBase } from '../ui/WindowBase';
import './css/QuizWindow.css';

interface QuizWindowProps {
    isOpen: boolean;
    onClose: () => void;
}

export const QuizWindow: React.FC<QuizWindowProps> = ({ isOpen, onClose }) => {
    return (
        <WindowBase isOpen={isOpen} onClose={onClose} title="Quiz Mode ✨">
            <div className="quiz-content-placeholder">
                <div className="quiz-icon-wrapper">
                    <span className="quiz-icon">🧠</span>
                </div>
                <h3 className="quiz-placeholder-title">Ready to test your knowledge?</h3>
                <p className="quiz-placeholder-desc">
                    The AI is currently generating quiz questions based on the article you just read. 
                    Get ready to challenge your understanding!
                </p>
                <div className="quiz-options-placeholder">
                    <div className="quiz-option-skeleton"></div>
                    <div className="quiz-option-skeleton"></div>
                    <div className="quiz-option-skeleton"></div>
                </div>
                <button className="quiz-action-button" onClick={onClose}>
                    Got it!
                </button>
            </div>
        </WindowBase>
    );
};
