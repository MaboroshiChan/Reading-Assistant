import React, { useState } from "react";
import type { Paragraph } from "../analysis/structure/Paragraph";
import { SentenceComponent } from "./SentenceComponent";
import './css/SemanticParagraph.css'
import { OrderedSet } from "immutable";

interface ParagraphComponentProps {
  paragraph: Paragraph;
}

export const ParagraphComponent: React.FC<ParagraphComponentProps> = ({ paragraph }) => {

  const [hoveredPath, setHoveredPath] = useState<OrderedSet<string>>(OrderedSet([]));

  return (
    <div className="paragraph" data-paragraph-id={paragraph.id}>
      {paragraph.sentences.map((sentence) => (
        <SentenceComponent
          key={sentence.id}
          node={sentence.semanticTree}
          onHoverNode={(id) => {
            console.log(`pushed id = ${id}`)
            const next = hoveredPath.add(id)
            setHoveredPath(next)
            console.log(`pushed path = ${next}`);
          }}
          onLeaveNode={(id) => {
            /** 
            const index = hoveredPath.indexOf(id);
            if (index !== -1) {
              setHoveredPath(hoveredPath.slice(0, index));
            }
            */
            const next = hoveredPath.delete(hoveredPath.last() as string);
            console.log(`popped id = ${id}`)
            setHoveredPath(next)
            console.log(`popped path = ${next}`);
          }}
          hoveredPath={hoveredPath}
        />
      ))}
    </div>
  );
};