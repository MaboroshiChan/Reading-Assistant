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
  topicSentence?: { is_implicit: boolean; text: string; id?: string };
  errorMessage?: string;
}

/**
 * Maps a Paragraph model and its (optional) analysis result to a ViewModel.
 *
 * @param paragraph - The base paragraph model.
 * @param analysis - The optional deep analysis data.
 * @returns A UI-friendly view model.
 */
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
    topicSentence: paragraph.topicSentence ?? analysis?.topic_sentence,
    errorMessage: paragraph.errorMessage,
  };
};

export default mapParagraphToVM;
