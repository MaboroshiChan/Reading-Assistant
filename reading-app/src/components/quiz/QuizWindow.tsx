import React, { useState, useEffect } from 'react';
import { WindowBase } from '../ui/WindowBase';
import type { QuizQuestion } from '../../services/envelopes';
import './css/QuizWindow.css';

interface QuizWindowProps {
    isOpen: boolean;
    onClose: () => void;
    questions: QuizQuestion[] | null;
    isLoading: boolean;
}

export const QuizWindow: React.FC<QuizWindowProps> = ({ isOpen, onClose, questions, isLoading }) => {
    const [currentQuestionIndex, setCurrentQuestionIndex] = useState(0);
    const [selectedOption, setSelectedOption] = useState<number | null>(null);
    const [isAnswerRevealed, setIsAnswerRevealed] = useState(false);
    const [score, setScore] = useState(0);
    const [isQuizComplete, setIsQuizComplete] = useState(false);

    // Reset state when window opens/closes or new questions arrive
    useEffect(() => {
        if (isOpen && questions) {
            setCurrentQuestionIndex(0);
            setSelectedOption(null);
            setIsAnswerRevealed(false);
            setScore(0);
            setIsQuizComplete(false);
        }
    }, [isOpen, questions]);

    const handleOptionSelect = (index: number) => {
        if (isAnswerRevealed) return;
        setSelectedOption(index);
    };

    const handleCheckAnswer = () => {
        if (selectedOption === null || !questions) return;
        
        const currentQ = questions[currentQuestionIndex];
        setIsAnswerRevealed(true);
        if (selectedOption === currentQ.correctAnswerIndex) {
            setScore(prev => prev + 1);
        }
    };

    const handleNextQuestion = () => {
        if (!questions) return;
        
        if (currentQuestionIndex < questions.length - 1) {
            setCurrentQuestionIndex(prev => prev + 1);
            setSelectedOption(null);
            setIsAnswerRevealed(false);
        } else {
            setIsQuizComplete(true);
        }
    };

    const renderPlaceholder = () => (
        <div className="quiz-content-placeholder">
            <div className="quiz-icon-wrapper">
                <span className="quiz-icon">🧠</span>
            </div>
            <h3 className="quiz-placeholder-title">
                {isLoading ? "Quizzes are waiting to be generated..." : "Ready to test your knowledge?"}
            </h3>
            <p className="quiz-placeholder-desc">
                {isLoading 
                    ? "The AI is currently crafting ETS-style questions based on the article. Please wait a moment." 
                    : "Generate a quiz to test your understanding!"}
            </p>
            {isLoading && (
                <div className="quiz-options-placeholder">
                    <div className="quiz-option-skeleton"></div>
                    <div className="quiz-option-skeleton"></div>
                    <div className="quiz-option-skeleton"></div>
                </div>
            )}
            {!isLoading && !questions && (
                <button className="quiz-action-button" onClick={onClose}>
                    Got it!
                </button>
            )}
        </div>
    );

    const renderQuizComplete = () => (
        <div className="quiz-content-placeholder quiz-complete">
            <div className="quiz-icon-wrapper success">
                <span className="quiz-icon">🏆</span>
            </div>
            <h3 className="quiz-placeholder-title">Quiz Complete!</h3>
            <p className="quiz-score-display">
                You scored <span className="score-highlight">{score}</span> out of {questions?.length}
            </p>
            <button className="quiz-action-button" onClick={onClose}>
                Close Quiz
            </button>
        </div>
    );

    const renderActiveQuiz = () => {
        if (!questions) return null;
        const q = questions[currentQuestionIndex];

        return (
            <div className="quiz-active-container">
                <div className="quiz-progress">
                    Question {currentQuestionIndex + 1} of {questions.length}
                </div>
                <h4 className="quiz-question-text">{q.question}</h4>
                
                <div className="quiz-options-list">
                    {q.options.map((opt, idx) => {
                        let className = "quiz-option-button";
                        if (selectedOption === idx) className += " selected";
                        
                        if (isAnswerRevealed) {
                            if (idx === q.correctAnswerIndex) {
                                className += " correct";
                            } else if (selectedOption === idx && idx !== q.correctAnswerIndex) {
                                className += " incorrect";
                            }
                        }

                        return (
                            <button 
                                key={idx} 
                                className={className}
                                onClick={() => handleOptionSelect(idx)}
                                disabled={isAnswerRevealed}
                            >
                                <span className="quiz-option-label">{String.fromCharCode(65 + idx)}</span>
                                <span className="quiz-option-text">{opt}</span>
                            </button>
                        );
                    })}
                </div>

                {isAnswerRevealed && (
                    <div className={`quiz-explanation ${selectedOption === q.correctAnswerIndex ? 'success' : 'error'}`}>
                        <div className="explanation-header">
                            {selectedOption === q.correctAnswerIndex ? '✅ Correct!' : '❌ Incorrect.'}
                        </div>
                        <p className="explanation-text">{q.explanation}</p>
                    </div>
                )}

                <div className="quiz-footer-actions">
                    {!isAnswerRevealed ? (
                        <button 
                            className="quiz-action-button" 
                            onClick={handleCheckAnswer}
                            disabled={selectedOption === null}
                        >
                            Check Answer
                        </button>
                    ) : (
                        <button 
                            className="quiz-action-button" 
                            onClick={handleNextQuestion}
                        >
                            {currentQuestionIndex < questions.length - 1 ? 'Next Question' : 'View Results'}
                        </button>
                    )}
                </div>
            </div>
        );
    };

    return (
        <WindowBase isOpen={isOpen} onClose={onClose} title="Quiz Mode ✨">
            {isLoading || !questions ? renderPlaceholder() : isQuizComplete ? renderQuizComplete() : renderActiveQuiz()}
        </WindowBase>
    );
};
