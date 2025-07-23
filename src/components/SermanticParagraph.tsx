import React from "react";
//import { SemanticSentence } from "./SemanticSentence";
import { Paragraph } from "../analysis/structure/Paragraph"; // adjust the import path as needed
import "./css/SemanticParagraph.css";
import type { Sentence } from "../analysis/structure/Sentence";
import { Highlighter } from "./SentenceLabels";
import type { LLMAnalysis } from "../analysis/structure/Sentence"; // Assuming this is the correct import path for LLMAnalysis

interface ParagraphProps {
  paragraph: Paragraph;
}

export const SemanticParagraph: React.FC<ParagraphProps> = ({ paragraph }) => {
  const id = paragraph.getId();
  const mainIdea = paragraph.getMainIdea();

  // SemanticSentenceLabels needs to be replaced with the Hightlighter Component.
  return (
    <div
      className="semantic-paragraph"
      id={id !== undefined ? `paragraph-${id}` : undefined}
      data-main-idea={mainIdea || undefined}
    >

      {
        paragraph.getSentences().map((sentence: Sentence, index: number) => (
          <span key={index} className="semantic-sentence-container">
            <Highlighter data={}/>
          </span>
        ))
      }
      
    </div>
  );
};