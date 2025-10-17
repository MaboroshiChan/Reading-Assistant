import React, { useCallback, useState, type MouseEvent } from "react";
import type { Paragraph } from "../analysis/structure/Paragraph";
import "./css/SemanticParagraph.css";
import SentenceComponent from "./SentenceComponent";
import { SentenceHoverCard } from "./SentenceHoverCard";

interface ParagraphComponentProps {
  paragraph: Paragraph;
}

type Point = { x: number; y: number };

type Variant = "blue" | "green" | "yellow" | "gray";

const tagPalette: Record<Variant, { background: string; color: string }> = {
  blue: { background: "rgba(123,168,255,0.24)", color: "#dde6ff" },
  green: { background: "rgba(103,232,185,0.22)", color: "#d2f5ea" },
  yellow: { background: "rgba(253,224,138,0.24)", color: "#fef3c7" },
  gray: { background: "rgba(226,232,240,0.18)", color: "#e2e8f0" },
};

const structureVariant = (value?: Paragraph["structureType"]): Variant => {
  if (!value) return "gray";
  const lower = value.toLowerCase();
  if (lower.includes("progress")) return "blue";
  if (lower.includes("contrast") || lower.includes("compare")) return "yellow";
  if (lower.includes("cause") || lower.includes("causal")) return "green";
  return "gray";
};

const functionVariant = (value?: Paragraph["function"]): Variant => {
  if (!value) return "gray";
  const lower = value.toLowerCase();
  if (lower.includes("intro")) return "yellow";
  if (lower.includes("conclu")) return "green";
  if (lower.includes("evidence") || lower.includes("premise")) return "blue";
  return "gray";
};

const formatCountLabel = (count: number): string =>
  `${count} sentence${count === 1 ? "" : "s"}`;

export const ParagraphComponent: React.FC<ParagraphComponentProps> = ({ paragraph }) => {
  const [isHovered, setIsHovered] = useState(false);
  const [isClicked, setIsClicked] = useState(false);
  const [anchor, setAnchor] = useState<Point | null>(null);

  const handleMouseEnter = useCallback((event: MouseEvent<HTMLDivElement>) => {
    setIsHovered(true);
    if (isClicked) {
      setAnchor({ x: event.clientX, y: event.clientY });
    }
  }, [isClicked]);

  const handleMouseMove = useCallback((event: MouseEvent<HTMLDivElement>) => {
    if (isClicked) {
      setAnchor({ x: event.clientX, y: event.clientY });
    }
  }, [isClicked]);

  const handleMouseLeave = useCallback(() => {
    setIsHovered(false);
    if (!isClicked) {
      setAnchor(null);
    }
  }, [isClicked]);

  const handleClick = useCallback((event: MouseEvent<HTMLDivElement>) => {
    event.stopPropagation();
    const { clientX, clientY } = event;
    setIsClicked((prev) => {
      const next = !prev;
      if (next) {
        setAnchor({ x: clientX, y: clientY });
      } else {
        setAnchor(null);
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

  const sentenceCountLabel = formatCountLabel(paragraph.sentences.length);

  return (
    <>
      <div
        className={className}
        data-paragraph-id={paragraph.id}
        onMouseEnter={handleMouseEnter}
        onMouseMove={handleMouseMove}
        onMouseLeave={handleMouseLeave}
        onClick={handleClick}
      >
        {paragraph.sentences.map((sentence) => (
          <SentenceComponent key={sentence.id} sentence={sentence} />
        ))}
      </div>

      <SentenceHoverCard
        open={isClicked && Boolean(anchor)}
        anchor={anchor ?? undefined}
        showSubsentenceButton={false}
      >
        <div className="hovercard-content">
          <div className="tags">
            <span className="tag" style={tagPalette.gray}>
              Paragraph #{paragraph.id}
            </span>
            <span className="tag" style={tagPalette.gray}>
              {sentenceCountLabel}
            </span>
            {paragraph.structureType ? (
              <span className="tag" style={tagPalette[structureVariant(paragraph.structureType)]}>
                {paragraph.structureType}
              </span>
            ) : null}
            {paragraph.function ? (
              <span className="tag" style={tagPalette[functionVariant(paragraph.function)]}>
                {paragraph.function}
              </span>
            ) : null}
          </div>
          {paragraph.centralIdea ? (
            <div className="purpose">{paragraph.centralIdea}</div>
          ) : (
            <div className="purpose">No central idea provided yet for this paragraph.</div>
          )}
        </div>
      </SentenceHoverCard>
    </>
  );
};
