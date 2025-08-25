import React, { useState } from "react";
import type { Paragraph } from "../analysis/structure/Paragraph";
import { SentenceComponent } from "./SentenceComponent";
import './css/SemanticParagraph.css'

interface ParagraphComponentProps {
  paragraph: Paragraph;
}

export const ParagraphComponent: React.FC<ParagraphComponentProps> = ({ paragraph }) => {

  const [group, setGroup] = useState<string[]>([]);

  const getGroup = (grp: string[]) => { // need to improve 
      setGroup(grp);
  }

  console.log(`group = ${group}`)

  return (
    <div className="paragraph" data-paragraph-id={paragraph.id}>
      {paragraph.sentences.map((sentence) => (
        <SentenceComponent
          getGroup={getGroup}
          highlight={group}
          key={sentence.id}
          node={sentence.semanticTree}
          onHoverNode={() => {}}
          onLeaveNode={() => {}}
        />
      ))}
    </div>
  );
};