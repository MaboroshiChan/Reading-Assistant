import type { AnalyzeSubSentenceData, MicroRole } from '../../services/envelopes';
import type { Sentence } from '../structure/Sentence';
import type { SubSentenceAnalysis, SubUnit, SyntacticRole } from '../structure/SubSentence';

const clamp = (value: number, min: number, max: number): number => Math.min(Math.max(value, min), max);

const inferRole = (label?: string): SyntacticRole => {
  if (!label) return 'token';
  const normalized = label.toLowerCase();
  if (normalized.includes('subject')) return 'subject';
  if (normalized.includes('predicate') || normalized.includes('verb')) return 'predicate';
  if (normalized.includes('object')) return 'object';
  if (normalized.includes('complement')) return 'complement';
  if (normalized.includes('modifier') || normalized.includes('detail') || normalized.includes('adjunct')) {
    return 'modifier';
  }
  if (normalized.includes('connector') || normalized.includes('cue')) return 'connector';
  if (normalized.includes('clause')) return 'clause';
  if (normalized.includes('phrase')) return 'phrase';
  return 'token';
};

const extractText = (sentenceText: string, role: MicroRole): string => {
  const anchor = role.anchors?.[0];
  if (!anchor?.span) return role.label ?? sentenceText;
  const start = clamp(anchor.span.start, 0, sentenceText.length);
  const end = clamp(anchor.span.end, start, sentenceText.length);
  const fragment = sentenceText.slice(start, end).trim();
  if (fragment.length) return fragment;
  const fallback = sentenceText.slice(start, end);
  return role.label ?? (fallback.length ? fallback : sentenceText);
};

export const mapSubSentenceToAnalysis = (
  sentence: Sentence,
  data?: AnalyzeSubSentenceData | null,
): SubSentenceAnalysis => {
  const text = sentence.text;
  const microRoles = data?.micro_roles ?? [];

  const units: SubUnit[] = microRoles.map((role, index) => {
    const anchor = role.anchors?.[0];
    const id = anchor?.anchor_hash ?? `micro-${index}`;
    const displayText = extractText(text, role);
    return {
      id,
      text: displayText,
      role: inferRole(role.label),
      confidence: role.confidence,
      source: 'model',
      viewHint: role.label ? { label: role.label } : undefined,
      meta: anchor?.span ? { span: anchor.span } : undefined,
    };
  });

  if (units.length === 0) {
    units.push({
      id: `sentence-${sentence.id}`,
      text,
      role: 'token',
    });
  }

  const analysis: SubSentenceAnalysis = {
    sentenceId: String(sentence.id),
    text,
    units,
    confidence: data?.confidence,
    meta: {
      cueInteraction: data?.cue_interaction ?? null,
      contrastResolution: data?.contrast_resolution ?? null,
    },
    layoutHint: {
      highlightStrategy: 'semantics-first',
      cardMaxWidth: 860,
    },
  };

  return analysis;
};

export default mapSubSentenceToAnalysis;
