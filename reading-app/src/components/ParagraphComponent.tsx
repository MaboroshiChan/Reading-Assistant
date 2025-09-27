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
      setGroup(group => group.concat(grp))
  }

  const remove = (grp: string[]) => {
    setGroup(group => group.filter(x=>!grp.includes(x)))
  }

  const [highLightId, setHighlightId] = useState<string | null>(null);

  const select = (id: string) => {
    if(!highLightId) {
      return true;
    }
    return highLightId === id;
  }

  const sendClickedSentence = (id: string | null) => {
    setHighlightId(id);
  }
  //
  return (
    <div className="paragraph" data-paragraph-id={paragraph.id}>
      {paragraph.sentences.map((sentence) => (
        <SentenceComponent
          getGroup={getGroup}
          remove={remove}
          highlight={group.toArray()}
          highlightable={select(sentence.semanticTree.id)} // select the clicked sentence
          sendClicked={sendClickedSentence}
          key={sentence.id}
          node={sentence.semanticTree}
          increase={()=>{}}
          decrease={()=>{}}
        />
      ))}
    </div>
  );
};