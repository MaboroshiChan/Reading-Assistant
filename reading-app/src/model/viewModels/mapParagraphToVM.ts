import type { AnalyzeParagraphData } from '../../services/envelopes';
import type Paragraph from '../structure/Paragraph';

export interface ParagraphViewModel {
  id: string;
  centralIdea?: string;
  structureType?: Paragraph['structureType'];
  function?: Paragraph['function'];
  summary?: string;
  roles?: string[];
  confidence?: number;
}

export const mapParagraphToVM = (
  paragraph: Paragraph,
  analysis?: AnalyzeParagraphData | null,
): ParagraphViewModel => {
  return {
    id: String(paragraph.id),
    centralIdea: paragraph.centralIdea ?? analysis?.summary,
    structureType: paragraph.structureType,
    function: paragraph.function,
    summary: analysis?.summary,
    roles: analysis?.roles?.map((role) => role.role).filter(Boolean),
    confidence: analysis?.confidence,
  };
};

export default mapParagraphToVM;
