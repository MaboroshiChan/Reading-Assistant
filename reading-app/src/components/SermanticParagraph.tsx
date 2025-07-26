import React, { useState } from "react";
import type { Paragraph } from "../analysis/structure/Paragraph";
import { SentenceComponent } from "./SentenceComponent";

interface ParagraphComponentProps {
  paragraph: Paragraph;
}

export const ParagraphComponent: React.FC<ParagraphComponentProps> = ({ paragraph }) => {
  const [hoveredId, setHoveredId] = useState<string | null>(null);

  return (
    <div className="paragraph" data-paragraph-id={paragraph.id}>
      {paragraph.centralIdea && (
        <div className="central-idea">
          <strong>Central Idea:</strong> {paragraph.centralIdea}
        </div>
      )}
      {paragraph.sentences.map((sentence) => (
        <SentenceComponent
          key={sentence.id}
          node={sentence.semanticTree}
          onHoverNode={(id) => setHoveredId(id)}
          onLeaveNode={() => setHoveredId(null)}
          hoveredId={hoveredId}
        />
      ))}
    </div>
  );
};