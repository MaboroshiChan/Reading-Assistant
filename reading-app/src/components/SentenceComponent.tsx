import React, { useState, type KeyboardEvent, type MouseEvent } from "react";
import type { Sentence } from "../analysis/structure/Sentence";
import './css/SentenceComponent.css';

interface SentenceComponentProps {
    sentence: Sentence;
    onToggleFocus?: (id: number, isFocused: boolean) => void;
    onHoverChange?: (id: number, isHovered: boolean) => void;
}

export const SentenceComponent: React.FC<SentenceComponentProps> = ({ sentence, onToggleFocus, onHoverChange }) => {
    /**
    * Simplified: text highlight only
    */
    const [isClicked, setIsClicked] = useState(false);
    const [isHovered, setIsHovered] = useState(false);

    const handleClick = (e: MouseEvent<HTMLSpanElement>) => {
        e.stopPropagation();
        setIsClicked((prev) => {
            const next = !prev;
            onToggleFocus?.(sentence.id, next);
            return next;
        });
    };

    const handleKeyDown = (e: KeyboardEvent<HTMLSpanElement>) => {
        if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            setIsClicked((prev) => {
                const next = !prev;
                onToggleFocus?.(sentence.id, next);
                return next;
            });
        }
    };

    const handleMouseEnter = () => {
        setIsHovered(true);
        onHoverChange?.(sentence.id, true);
    };

    const handleMouseLeave = () => {
        setIsHovered(false);
        onHoverChange?.(sentence.id, false);
    };

    const className = [
        "sentence",
        "component",
        isHovered ? "hovered" : "",
        isClicked ? "clicked" : "",
    ]
        .filter(Boolean)
        .join(" ");

    return (
        <span
            role="button"
            tabIndex={0}
            aria-pressed={isClicked}
            onClick={handleClick}
            onKeyDown={handleKeyDown}
            onMouseEnter={handleMouseEnter}
            onMouseLeave={handleMouseLeave}
            className={className}
            data-sentence-id={sentence.id}
        >
            {sentence.text}
        </span>
    );
};

export default SentenceComponent;
