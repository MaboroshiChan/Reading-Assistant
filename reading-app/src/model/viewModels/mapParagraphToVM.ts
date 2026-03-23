import type { AnalyzeParagraphData } from '../../services/envelopes';
import type Paragraph from '../structure/Paragraph';

export interface ParagraphViewModel {
  id: string;
  tags?: { name: string; type: 'logic' | 'concept'; description?: string }[];
  structureType?: Paragraph['structureType'];
  function?: Paragraph['function'];
  summary?: string;
  roles?: string[];
  confidence?: number;
  errorMessage?: string;
  topicSentence?: {
    is_implicit?: boolean;
    text?: string;
    id?: string | number;
  };
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
    tags: paragraph.tags ?? analysis?.tags,
    structureType: paragraph.structureType,
    function: paragraph.function,
    summary: analysis?.summary,
    roles: analysis?.roles?.map((role) => role.role).filter(Boolean),
    confidence: analysis?.confidence,
    errorMessage: paragraph.errorMessage,
    topicSentence: paragraph.topicSentence ?? analysis?.topic_sentence,
  };
};

export default mapParagraphToVM;
