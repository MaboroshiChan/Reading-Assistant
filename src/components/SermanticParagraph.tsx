import React from "react";
import { SemanticSentence } from "./SemanticSentence";
import { Paragraph } from "../analysis/structure/Paragraph"; // adjust the import path as needed
import "./css/SemanticParagraph.css";
import type { Sentence } from "../analysis/structure/Sentence";

interface ParagraphProps {
  paragraph: Paragraph;
}

export const SemanticParagraph: React.FC<ParagraphProps> = ({ paragraph }) => {
  const id = paragraph.getId();
  const mainIdea = paragraph.getMainIdea();

  console.log("Rendering SemanticParagraph", {
    id,
    mainIdea,
    sentences: paragraph.getSentences()
  });

  return (
    <div
      className="semantic-paragraph"
      id={id !== undefined ? `paragraph-${id}` : undefined}
      data-main-idea={mainIdea || undefined}
    >
      {mainIdea && (
        <span className="semantic-paragraph-label">
          {mainIdea}
        </span>
      )}

      {paragraph.getSentences().map((sentence: Sentence) => (
        <SemanticSentence key={sentence.id} sentence={sentence} />
      ))}
    </div>
  );
};