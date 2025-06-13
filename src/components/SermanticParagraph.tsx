import { Paragraph } from "../analysis/structure/Paragraph";
import { SemanticSentence } from "./SemanticSentence";

interface ParagraphProps {
  paragraph: Paragraph;
}

export const SemanticParagraph: React.FC<ParagraphProps> = ({ paragraph }) => {
  return (
    <div className="paragraph">
      {paragraph.getSentences().map(sentence => (
        <SemanticSentence key={sentence.id} sentence={sentence} />
      ))}
    </div>
  );
};