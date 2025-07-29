import React, { useState } from "react";
import type { Paragraph } from "../analysis/structure/Paragraph";
import { SentenceComponent } from "./SentenceComponent";
import './css/SemanticParagraph.css'

interface ParagraphComponentProps {
  paragraph: Paragraph;
}

export const ParagraphComponent: React.FC<ParagraphComponentProps> = ({ paragraph }) => {
  const [hoveredId, setHoveredId] = useState<string | null>(null);

  return (
    <div className="paragraph" data-paragraph-id={paragraph.id}>
      {paragraph.sentences.map((sentence) => (
        <SentenceComponent
          key={sentence.id}
          node={sentence.semanticTree}
          onHoverNode={(id) => {
            console.log(`id = ${id}`)
            setHoveredId(id)}}
          onLeaveNode={() => setHoveredId(null)}
          hoveredId={hoveredId}
        />
      ))}
    </div>
  );
};