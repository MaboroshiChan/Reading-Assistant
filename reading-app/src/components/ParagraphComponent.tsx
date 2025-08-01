import React, { useState } from "react";
import type { Paragraph } from "../analysis/structure/Paragraph";
import { SentenceComponent } from "./SentenceComponent";
import './css/SemanticParagraph.css'
import { List } from "immutable";

interface ParagraphComponentProps {
  paragraph: Paragraph;
}

export const ParagraphComponent: React.FC<ParagraphComponentProps> = ({ paragraph }) => {

  const [hoveredPath, setHoveredPath] = useState<List<string>>(List([]));

  return (
    <div className="paragraph" data-paragraph-id={paragraph.id}>
      {paragraph.sentences.map((sentence) => (
        <SentenceComponent
          key={sentence.id}
          node={sentence.semanticTree}
          onHoverNode={(id) => {
            console.log(`id = ${id}`)
            setHoveredPath(hoveredPath.push(id))
          }}
          onLeaveNode={(id) => {
            /** 
            const index = hoveredPath.indexOf(id);
            if (index !== -1) {
              setHoveredPath(hoveredPath.slice(0, index));
            }
            */
            setHoveredPath(hoveredPath.pop())
          }}
          hoveredPath={hoveredPath}
        />
      ))}
    </div>
  );
};