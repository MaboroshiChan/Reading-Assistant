import React from "react";
import type { Paragraph } from "../analysis/structure/Paragraph";
import './css/SemanticParagraph.css'
import SentenceComponent from "./SentenceComponent";

interface ParagraphComponentProps {
  paragraph: Paragraph;
}

export const ParagraphComponent: React.FC<ParagraphComponentProps> = ({ paragraph }) => {

  
  return (
    <div className="paragraph" data-paragraph-id={paragraph.id}>
      {paragraph.sentences.map((sentence) => (
        <SentenceComponent
          key={sentence.id}
          sentence={sentence}
        />
      ))}
    </div>
  );
};