import React, { useCallback, useMemo, useState, type MouseEvent } from "react";
import type { Paragraph } from "../model/structure/Paragraph";
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

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const handleMouseEnter = useCallback((_event: MouseEvent<HTMLDivElement>) => {
    setIsHovered(true);
  }, []);

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
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
      data-paragraph-id={paragraphVm.id}
      onMouseEnter={handleMouseEnter}
      onMouseMove={handleMouseMove}
      onMouseLeave={handleMouseLeave}
      onClick={handleClick}
    >
      {paragraph.sentences.map((sentence) => (
        <SentenceComponent
          id={sentence.id - paragraph.id}
          key={sentence.id}
          sentence={sentence}
          interactionEnabled={isClicked}
        />
      ))}
    </div>
  );
};
