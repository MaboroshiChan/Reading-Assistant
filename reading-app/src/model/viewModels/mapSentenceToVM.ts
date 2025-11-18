import type { AnalyzeSentenceData, SentenceRole } from '../../services/envelopes';
import type { Sentence } from '../structure/Sentence';

export interface SentenceViewModel {
  id: string;
  text: string;
  paraphrase?: string;
  roleLabel?: string;
  structureLabel?: string;
  mood?: string;
  confidence?: number;
}

const pickPrimaryRole = (roles?: SentenceRole[]): SentenceRole | undefined => {
  if (!roles?.length) return undefined;
  if (roles.length === 1) return roles[0];
  return [...roles].sort((a, b) => (b.confidence ?? 0) - (a.confidence ?? 0))[0];
};

export const mapSentenceToVM = (
  sentence: Sentence,
  analysis?: AnalyzeSentenceData | null,
): SentenceViewModel => {
  const primaryRole = pickPrimaryRole(analysis?.semantic_roles);
  const structure = analysis?.discourse_function?.trim();

  return {
    id: String(sentence.id),
    text: sentence.text,
    paraphrase: undefined, // backend may add later; keep slot available
    roleLabel: primaryRole?.role ?? sentence.function,
    structureLabel: structure && structure.length > 0 ? structure : sentence.type,
    mood: sentence.mood,
    confidence: analysis?.confidence,
  };
};

export default mapSentenceToVM;
