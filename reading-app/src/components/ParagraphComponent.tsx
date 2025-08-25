import React, { useState } from "react";
import type { Paragraph } from "../analysis/structure/Paragraph";
import { SentenceComponent } from "./SentenceComponent";
import './css/SemanticParagraph.css'
import { Set } from "immutable";

interface ParagraphComponentProps {
  paragraph: Paragraph;
}

export const ParagraphComponent: React.FC<ParagraphComponentProps> = ({ paragraph }) => {

  const [group, setGroup] = useState<Set<string>>(Set());

  const getGroup = (grp: string[]) => { 
      console.log(`grp = ${grp}`)
      setGroup(group => group.concat(grp))
  }

  const remove = (grp: string[]) => {
    console.log(grp);
    setGroup(group => group.filter(x=>!grp.includes(x)))
  }

  console.log(`${group}`)

  return (
    <div className="paragraph" data-paragraph-id={paragraph.id}>
      {paragraph.sentences.map((sentence) => (
        <SentenceComponent
          getGroup={getGroup}
          remove={remove}
          highlight={group.toArray()}
          key={sentence.id}
          node={sentence.semanticTree}
        />
      ))}
    </div>
  );
};