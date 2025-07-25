import React, { useState } from "react";
import { Sentence } from "../analysis/structure/Sentence";
//import { SemanticToken } from "./SemanticToken";
import "./css/SemanticSentence.css"; // Assuming you have a CSS file for styling
import "./css/SemanticLabels.css"; // Assuming you have a CSS file for styling labels
//import { SemanticSentenceLabels } from "./SentenceLabels";

interface SentenceProps {
  sentence: Sentence;
}

export const SemanticSentence: React.FC<SentenceProps> = ({ sentence }) => {
  const [hovered, setHovered] = useState(false);
  return (
    <span
      data-function={sentence.function}
      data-type={sentence.type}
      data-purpose={sentence.purpose}
      data-mood={sentence.mood}
      className={`sentence-frame ${hovered ? 'hovered' : ''}`}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      {sentence.getRawText()}
    </span>
  );
};