import React, { useEffect, useState } from "react";
import { Paragraph } from "../analysis/structure/Paragraph";
import { Highlighter } from "./SentenceLabels";
import type { LLMAnalysis } from "../analysis/structure/Sentence";
import { fetchLLMAnalysis } from "../services/llmClient"; // ✅ FIXED

interface ParagraphProps {
  paragraph: Paragraph;
}

export const SemanticParagraph: React.FC<ParagraphProps> = ({ paragraph }) => {
  const [analysis, setAnalysis] = useState<LLMAnalysis[]>(paragraph.getLLMAnalysis());

  useEffect(() => {
    if (analysis.length === 0 && paragraph.getRawText().trim().length > 0) {
      fetchLLMAnalysis(paragraph.getRawText())
        .then(setAnalysis)
        .catch(err => {
          console.error("Failed to fetch LLM analysis:", err);
        });
    }
  }, [analysis, paragraph]); // ✅ Remove 'analysis' to prevent repeated fetch

  const id = paragraph.getId();
  const mainIdea = paragraph.getMainIdea();

  return (
    <div
      className="semantic-paragraph"
      id={id !== undefined ? `paragraph-${id}` : undefined}
      data-main-idea={mainIdea || undefined}
    >
      {analysis.map((a, idx) => (
        <Highlighter key={a.id || idx} data={a} />
      ))}
    </div>
  );
};