import React, { useCallback, useMemo, useState, type MouseEvent } from "react";
import type Paragraph from "../model/structure/Paragraph";
import "./css/SemanticParagraph.css";
import SentenceComponent from "./SentenceComponent";
import mapParagraphToVM from "../model/viewModels/mapParagraphToVM";

// There is no paragraph hover card

interface ParagraphComponentProps {
  paragraph: Paragraph;
}

export const ParagraphComponent: React.FC<ParagraphComponentProps> = ({ paragraph }) => {
  const [isHovered, setIsHovered] = useState(false);
  const [isClicked, setIsClicked] = useState(false);
  const paragraphVm = useMemo(() => mapParagraphToVM(paragraph), [paragraph]);

  const isInteractive = !paragraph.status || paragraph.status === 'complete';

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const handleMouseEnter = useCallback((_event: MouseEvent<HTMLDivElement>) => {
    if (isInteractive) setIsHovered(true);
  }, [isInteractive]);

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const handleMouseMove = useCallback((_event: MouseEvent<HTMLDivElement>) => {
    // no-op for now; reserved for future pointer sync
  }, []);

  const handleMouseLeave = useCallback(() => {
    setIsHovered(false);
  }, []);

  const handleClick = useCallback((event: MouseEvent<HTMLDivElement>) => {
    event.stopPropagation();
    if (!isInteractive) return;
    setIsClicked((prev) => {
      const next = !prev;
      if (!next) {
        setIsHovered(false);
      }
      return next;
    });
  }, [isInteractive]);

  const className = [
    "paragraph",
    "component",
    isHovered ? "hovered" : "",
    isClicked ? "clicked" : "",
    paragraph.status ? `status-${paragraph.status}` : "",
  ]
    .filter(Boolean)
    .join(" ");

  // Visual feedback for pending state (Gray)
  const style: React.CSSProperties = {
    transition: "all 0.5s ease",
    ...(paragraph.status === "pending"
      ? { opacity: 0.6, filter: "grayscale(100%)" }
      : {}),
    // Disable interactions (including CSS :hover) until analysis is complete
    ...(!isInteractive ? { pointerEvents: "none" } : {}),
  };

  return (
    <div
      className={className}
      data-paragraph-id={paragraphVm.id}
      style={style}
      onMouseEnter={handleMouseEnter}
      onMouseMove={handleMouseMove}
      onMouseLeave={handleMouseLeave}
      onClick={handleClick}
    >
      {paragraph.sentences.map((sentence) => (
        <SentenceComponent
          id={sentence.id - paragraph.id}
          paragraphId={paragraph.id}
          key={sentence.id}
          sentence={sentence}
          interactionEnabled={isInteractive}
        />
      ))}
    </div>
  );
};
