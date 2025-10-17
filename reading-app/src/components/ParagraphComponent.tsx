import React, { useCallback, useState, type MouseEvent } from "react";
import type { Paragraph } from "../analysis/structure/Paragraph";
import "./css/SemanticParagraph.css";
import SentenceComponent from "./SentenceComponent";

interface ParagraphComponentProps {
  paragraph: Paragraph;
}

export const ParagraphComponent: React.FC<ParagraphComponentProps> = ({ paragraph }) => {
  const [isHovered, setIsHovered] = useState(false);
  const [isClicked, setIsClicked] = useState(false);

  const handleMouseEnter = useCallback((_event: MouseEvent<HTMLDivElement>) => {
    setIsHovered(true);
  }, []);

  const handleMouseMove = useCallback((_event: MouseEvent<HTMLDivElement>) => {
    // no-op for now; reserved for future pointer sync
  }, []);

  const handleMouseLeave = useCallback(() => {
    setIsHovered(false);
  }, []);

  const handleClick = useCallback((event: MouseEvent<HTMLDivElement>) => {
    event.stopPropagation();
    setIsClicked((prev) => {
      const next = !prev;
      if (!next) {
        setIsHovered(false);
      }
      return next;
    });
  }, []);

  const className = [
    "paragraph",
    "component",
    isHovered ? "hovered" : "",
    isClicked ? "clicked" : "",
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <div
      className={className}
      data-paragraph-id={paragraph.id}
      onMouseEnter={handleMouseEnter}
      onMouseMove={handleMouseMove}
      onMouseLeave={handleMouseLeave}
      onClick={handleClick}
    >
      {paragraph.sentences.map((sentence) => (
        <SentenceComponent
          key={sentence.id}
          sentence={sentence}
          interactionEnabled={isClicked}
        />
      ))}
    </div>
  );
};
