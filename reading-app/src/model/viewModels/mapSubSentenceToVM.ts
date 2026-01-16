import type {
  AnalyzeSubSentenceData,
  SubSentenceAnalysisData,
  SubSentenceUnitData,
} from '../../services/envelopes';
import {
  DefaultLegend,
  type ColorVariant,
  type SemanticRoleName,
  type SemanticTag,
  type SubSentenceAnalysis,
  type SubUnit,
  type SyntacticRole,
} from '../structure/SubSentence';

export interface SubSentenceViewModel {
  analysis: SubSentenceAnalysis;
  confidence?: number;
  unitsById: Map<string, SubUnit>;
}

export type SubsentenceVM = SubSentenceViewModel;

const ROLE_ALIAS: Record<string, SyntacticRole> = {
  subject: 'subject',
  subj: 'subject',
  agent: 'subject',
  predicate: 'predicate',
  pred: 'predicate',
  verb: 'predicate',
  object: 'object',
  obj: 'object',
  patient: 'object',
  complement: 'complement',
  comp: 'complement',
  modifier: 'modifier',
  mod: 'modifier',
  adjunct: 'modifier',
  connector: 'connector',
  conj: 'connector',
  clause: 'clause',
  phrase: 'phrase',
  token: 'token',
};

const SEMANTIC_ALIAS: Record<string, SemanticTag> = {
  cause: 'cause',
  causal: 'cause',
  result: 'result',
  consequence: 'result',
  condition: 'condition',
  conditional: 'condition',
  concession: 'concession',
  purpose: 'purpose',
  goal: 'purpose',
  contrast: 'contrast',
  transition: 'transition',
  example: 'example',
  definition: 'definition',
  emphasis: 'emphasis',
  highlight: 'emphasis',
  topic: 'topic',
  theme: 'topic',
  comment: 'comment',
  time: 'time',
  temporal: 'time',
  location: 'location',
  place: 'location',
  manner: 'manner',
  evaluation: 'evaluation',
  assessment: 'evaluation',
  attribution: 'attribution',
  reporting: 'reporting',
  modality: 'modality',
  none: 'none',
};

const SEMROLE_ALIAS: Record<string, SemanticRoleName> = {
  agent: 'Agent',
  actor: 'Agent',
  causer: 'Agent',
  patient: 'Patient',
  object: 'Patient',
  theme: 'Theme',
  experiencer: 'Experiencer',
  instrument: 'Instrument',
  tool: 'Instrument',
  goal: 'Goal',
  destination: 'Goal',
  source: 'Source',
  origin: 'Source',
  location: 'Location',
  place: 'Location',
  time: 'Time',
  manner: 'Manner',
  cause: 'Cause',
  reason: 'Cause',
  condition: 'Condition',
  none: 'None',
};

const VARIANT_VALUES: readonly ColorVariant[] = ['blue', 'green', 'yellow', 'gray'];
const UNIT_SOURCES = ['manual', 'model', 'hybrid'] as const;
type UnitSource = typeof UNIT_SOURCES[number];
type VariantPaletteInput = Record<string, { bg?: string; fg?: string; dot?: string }>;
type VariantPaletteOutput = Partial<Record<ColorVariant, { bg: string; fg: string; dot: string }>>;

const ISSUE_ALIAS = {
  overlap: 'overlap',
  gap: 'gap',
  conflict: 'conflict',
  lowconfidence: 'lowConfidence',
  'low-confidence': 'lowConfidence',
  unparsed: 'unparsed',
} as const;

const DENSITY_VALUES = ['normal', 'dense'] as const;
type DensityValue = typeof DENSITY_VALUES[number];

const HIGHLIGHT_VALUES = ['semantics-first', 'role-first', 'semantic-role', 'mixed'] as const;
type HighlightValue = typeof HIGHLIGHT_VALUES[number];

export const mapSubSentenceToVM = (
  data?: AnalyzeSubSentenceData | null,
): SubsentenceVM | null => {
  if (!data) return null;

  const analysis = sanitizeAnalysis(data.analysis);
  const unitsById = new Map<string, SubUnit>();
  collectUnits(analysis.units, unitsById);

  const topConfidence = clampConfidence(data.confidence);
  if (typeof topConfidence === 'number' && typeof analysis.confidence !== 'number') {
    analysis.confidence = topConfidence;
  }

  return {
    analysis,
    confidence: typeof topConfidence === 'number' ? topConfidence : analysis.confidence,
    unitsById,
  };
};

const sanitizeAnalysis = (analysis?: SubSentenceAnalysisData): SubSentenceAnalysis => {
  const sentenceId = analysis?.sentenceId ?? 'unknown';
  const text = analysis?.text ?? '';
  const units = Array.isArray(analysis?.units)
    ? analysis.units
      .map((unit) => sanitizeUnit(unit))
      .filter((unit): unit is SubUnit => unit !== null)
    : [];

  const finalUnits = units.length ? units : [buildFallbackUnit(text || sentenceId)];
  const backbone = sanitizeBackbone(analysis?.backbone, finalUnits);
  const legend = sanitizeLegend(analysis?.legend);
  const layoutHint = sanitizeLayoutHint(analysis?.layoutHint);
  const analyzedAt = sanitizeIsoString(analysis?.analyzedAt);
  const version =
    typeof analysis?.version === 'number' && Number.isFinite(analysis.version)
      ? Math.trunc(analysis.version)
      : undefined;
  const confidence = clampConfidence(analysis?.confidence);
  const issues = sanitizeIssues(analysis?.issues);
  const annotations = sanitizeAnnotations(analysis?.annotations);
  const meta = sanitizeMeta(analysis?.meta);

  return {
    sentenceId,
    text,
    units: finalUnits,
    backbone, // Allow undefined
    legend,   // Allow undefined
    layoutHint, // Allow undefined 
    analyzedAt, // Allow undefined
    version, // Allow undefined
    confidence, // Allow undefined
    issues, // Allow undefined
    annotations, // Allow undefined
    meta, // Allow undefined
  };
};

const sanitizeUnit = (unit?: SubSentenceUnitData | null): SubUnit | null => {
  if (!unit) return null;
  const id = sanitizeId(unit.id);
  const text = typeof unit.text === 'string' ? unit.text.trim() : '';
  if (!id || !text) return null;

  const role = canonicalRole(unit.role);
  const semantics = canonicalSemantics(unit.semantics);
  const semRole = canonicalSemRole(unit.semRole);
  const confidence = clampConfidence(unit.confidence);
  const source = canonicalSource(unit.source);
  const meta = sanitizeMeta(unit.meta);
  const viewHint = sanitizeViewHint(unit.viewHint);

  const children = Array.isArray(unit.children)
    ? unit.children
      .map((child) => sanitizeUnit(child))
      .filter((child): child is SubUnit => child !== null)
    : undefined;

  const clause = unit.clause ? sanitizeAnalysis(unit.clause) : undefined;

  return {
    id,
    text,
    ...(role ? { role } : {}),
    ...(semantics ? { semantics } : {}),
    ...(semRole ? { semRole } : {}),
    ...(confidence !== undefined ? { confidence } : {}),
    ...(source ? { source } : {}),
    ...(meta ? { meta } : {}),
    ...(viewHint ? { viewHint } : {}),
    ...(children?.length ? { children } : {}),
    ...(clause ? { clause } : {}),
  };
};

const sanitizeBackbone = (
  backbone: SubSentenceAnalysisData['backbone'] | undefined,
  units: SubUnit[],
): SubSentenceAnalysis['backbone'] | undefined => {
  const fromData = backbone ?? {};
  const subjectId = sanitizeId(fromData.subjectId);
  const predicateId = sanitizeId(fromData.predicateId);
  const objectId = sanitizeId(fromData.objectId);

  const derived = {
    subjectId: subjectId ?? findUnitByRole('subject', units),
    predicateId: predicateId ?? findUnitByRole('predicate', units),
    objectId: objectId ?? findUnitByRole('object', units),
  };

  if (!derived.subjectId && !derived.predicateId && !derived.objectId) return undefined;
  return {
    ...(derived.subjectId ? { subjectId: derived.subjectId } : {}),
    ...(derived.predicateId ? { predicateId: derived.predicateId } : {}),
    ...(derived.objectId ? { objectId: derived.objectId } : {}),
  };
};

const sanitizeLegend = (
  legend: SubSentenceAnalysisData['legend'] | undefined,
): SubSentenceAnalysis['legend'] | undefined => {
  if (!legend) return undefined;
  const semanticsToVariant = sanitizeLegendEntries(legend.semanticsToVariant, canonicalSemantics);
  const roleToVariant = sanitizeLegendEntries(legend.roleToVariant, canonicalRole);
  const semRoleToVariant = sanitizeLegendEntries(legend.semRoleToVariant, canonicalSemRole);
  const variantPalette = sanitizeVariantPalette(legend.variantPalette as VariantPaletteInput | undefined);

  if (!semanticsToVariant && !roleToVariant && !semRoleToVariant && !variantPalette) {
    return undefined;
  }

  return {
    semanticsToVariant: semanticsToVariant ?? DefaultLegend.semanticsToVariant,
    roleToVariant: roleToVariant ?? DefaultLegend.roleToVariant,
    semRoleToVariant: semRoleToVariant ?? DefaultLegend.semRoleToVariant,
    variantPalette: variantPalette ?? DefaultLegend.variantPalette,
  };
};

const sanitizeLegendEntries = <T extends string>(
  input: Record<string, string> | undefined,
  resolve: (value: unknown) => T | undefined,
): Partial<Record<T, ColorVariant>> | undefined => {
  if (!input) return undefined;
  const entries: Array<[T, ColorVariant]> = [];
  for (const [rawKey, rawVariant] of Object.entries(input)) {
    const key = resolve(rawKey);
    const variant = canonicalVariant(rawVariant);
    if (!key || !variant) continue;
    entries.push([key, variant]);
  }
  return entries.length ? (Object.fromEntries(entries) as Partial<Record<T, ColorVariant>>) : undefined;
};

const sanitizeVariantPalette = (
  palette: VariantPaletteInput | undefined,
): VariantPaletteOutput | undefined => {
  if (!palette) return undefined;
  const entries: Array<[ColorVariant, { bg: string; fg: string; dot: string }]> = [];
  for (const [variantKey, colors] of Object.entries(palette)) {
    const variant = canonicalVariant(variantKey);
    if (!variant || !colors) continue;
    const bg = typeof colors.bg === 'string' ? colors.bg : undefined;
    const fg = typeof colors.fg === 'string' ? colors.fg : undefined;
    const dot = typeof colors.dot === 'string' ? colors.dot : undefined;
    if (!bg || !fg || !dot) continue;
    entries.push([variant, { bg, fg, dot }]);
  }
  return entries.length ? Object.fromEntries(entries) : undefined;
};

const sanitizeLayoutHint = (
  hint: SubSentenceAnalysisData['layoutHint'] | undefined,
): SubSentenceAnalysis['layoutHint'] | undefined => {
  if (!hint) return undefined;
  const density = canonicalDensity(hint.density);
  const highlightStrategy = canonicalHighlight(hint.highlightStrategy);
  const showLabels = typeof hint.showLabels === 'boolean' ? hint.showLabels : undefined;
  const showCaret = typeof hint.showCaret === 'boolean' ? hint.showCaret : undefined;
  const cardMaxWidth =
    typeof hint.cardMaxWidth === 'number' && Number.isFinite(hint.cardMaxWidth)
      ? Math.max(0, Math.trunc(hint.cardMaxWidth))
      : undefined;

  if (!density && !highlightStrategy && showLabels === undefined && showCaret === undefined && cardMaxWidth === undefined) {
    return undefined;
  }

  return {
    ...(density ? { density } : {}),
    ...(highlightStrategy ? { highlightStrategy } : {}),
    ...(showLabels !== undefined ? { showLabels } : {}),
    ...(showCaret !== undefined ? { showCaret } : {}),
    ...(cardMaxWidth !== undefined ? { cardMaxWidth } : {}),
  };
};

const sanitizeIssues = (
  issues: SubSentenceAnalysisData['issues'] | undefined,
): SubSentenceAnalysis['issues'] | undefined => {
  if (!issues?.length) return undefined;
  const mapped = issues
    .map((issue) => {
      if (!issue || typeof issue !== 'object') return null;
      const type = canonicalIssueType((issue as { type?: string }).type);
      const message = typeof issue.message === 'string' ? issue.message : undefined;
      const unitIds = Array.isArray(issue.unitIds)
        ? issue.unitIds.map((id) => sanitizeId(id)).filter((id): id is string => Boolean(id))
        : undefined;
      if (!type) return null;
      return {
        type,
        message: message ?? type,
        ...(unitIds?.length ? { unitIds } : {}),
      };
    })
    .filter((item): item is NonNullable<typeof item> => item !== null);
  return mapped.length ? mapped : undefined;
};

const sanitizeAnnotations = (
  annotations: SubSentenceAnalysisData['annotations'] | undefined,
): SubSentenceAnalysis['annotations'] | undefined => {
  if (!annotations?.length) return undefined;
  const mapped = annotations
    .map((annotation) => {
      if (!annotation) return null;
      const userId = sanitizeId(annotation.userId);
      const note = typeof annotation.note === 'string' ? annotation.note : undefined;
      const createdAt = sanitizeIsoString(annotation.createdAt);
      const targetUnitId = sanitizeId(annotation.targetUnitId);
      if (!userId || !note || !createdAt) return null;
      return {
        userId,
        note,
        createdAt,
        ...(targetUnitId ? { targetUnitId } : {}),
      };
    })
    .filter((item): item is NonNullable<typeof item> => item !== null);
  return mapped.length ? mapped : undefined;
};

const sanitizeMeta = (meta: unknown): Record<string, unknown> | undefined => {
  if (!meta || typeof meta !== 'object') return undefined;
  return { ...(meta as Record<string, unknown>) };
};

const sanitizeViewHint = (
  hint: SubSentenceUnitData['viewHint'] | undefined,
): SubUnit['viewHint'] | undefined => {
  if (!hint) return undefined;
  const variant = canonicalVariant(hint.variant);
  const collapsed = typeof hint.collapsed === 'boolean' ? hint.collapsed : undefined;
  const label = typeof hint.label === 'string' && hint.label.trim().length ? hint.label : undefined;
  const order =
    typeof hint.order === 'number' && Number.isFinite(hint.order)
      ? Math.trunc(hint.order)
      : undefined;

  if (!variant && collapsed === undefined && !label && order === undefined) return undefined;
  return {
    ...(variant ? { variant } : {}),
    ...(collapsed !== undefined ? { collapsed } : {}),
    ...(label ? { label } : {}),
    ...(order !== undefined ? { order } : {}),
  };
};

const canonicalRole = (value: unknown): SyntacticRole | undefined => {
  const key = asLower(value);
  return key ? ROLE_ALIAS[key] : undefined;
};

const canonicalSemantics = (value: unknown): SemanticTag | undefined => {
  const key = asLower(value);
  return key ? SEMANTIC_ALIAS[key] : undefined;
};

const canonicalSemRole = (value: unknown): SemanticRoleName | undefined => {
  const key = asLower(value);
  return key ? SEMROLE_ALIAS[key] : undefined;
};

const canonicalVariant = (value: unknown): ColorVariant | undefined => {
  const key = asLower(value);
  return VARIANT_VALUES.includes(key as ColorVariant) ? (key as ColorVariant) : undefined;
};

const canonicalSource = (value: unknown): UnitSource | undefined => {
  const key = asLower(value);
  if (!key) return undefined;
  if ((UNIT_SOURCES as readonly string[]).includes(key)) {
    return key as UnitSource;
  }
  if (key.startsWith('model')) return 'model';
  return undefined;
};

const canonicalIssueType = (
  value: unknown,
): 'overlap' | 'gap' | 'conflict' | 'lowConfidence' | 'unparsed' | undefined => {
  const key = asLower(value);
  if (!key) return undefined;
  return ISSUE_ALIAS[key as keyof typeof ISSUE_ALIAS];
};

const canonicalDensity = (value: unknown): DensityValue | undefined => {
  const key = asLower(value);
  return DENSITY_VALUES.includes(key as DensityValue) ? (key as DensityValue) : undefined;
};

const canonicalHighlight = (value: unknown): HighlightValue | undefined => {
  const key = asLower(value);
  return HIGHLIGHT_VALUES.includes(key as HighlightValue) ? (key as HighlightValue) : undefined;
};

const buildFallbackUnit = (value: string): SubUnit => {
  const text = value.trim() || 'fragment';
  const id = sanitizeId(text) ?? 'clause-1';
  return {
    id,
    text,
    role: 'clause',
    source: 'model',
    confidence: 0.5,
  };
};

const collectUnits = (units: SubUnit[], acc: Map<string, SubUnit>): void => {
  for (const unit of units) {
    acc.set(unit.id, unit);
    if (unit.children) {
      collectUnits(unit.children, acc);
    }
    if (unit.clause) {
      collectUnits(unit.clause.units, acc);
    }
  }
};

const findUnitByRole = (role: SyntacticRole, units: SubUnit[]): string | undefined => {
  for (const unit of units) {
    if (unit.role === role) return unit.id;
    if (unit.children) {
      const child = findUnitByRole(role, unit.children);
      if (child) return child;
    }
    if (unit.clause) {
      const nested = findUnitByRole(role, unit.clause.units);
      if (nested) return nested;
    }
  }
  return undefined;
};

const sanitizeId = (value: unknown): string | undefined => {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  if (!trimmed) return undefined;
  const cleaned = trimmed.replace(/[^A-Za-z0-9._-]/g, '');
  return cleaned || undefined;
};

const clampConfidence = (value: unknown): number | undefined => {
  if (typeof value !== 'number' || !Number.isFinite(value)) return undefined;
  if (value <= 0) return 0;
  if (value >= 1) return 1;
  return Number(Math.round(value * 1000) / 1000);
};

const sanitizeIsoString = (value: unknown): string | undefined => {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  if (!trimmed) return undefined;
  return Number.isNaN(Date.parse(trimmed)) ? undefined : trimmed;
};

const asLower = (value: unknown): string | undefined => {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  return trimmed ? trimmed.toLowerCase() : undefined;
};

export default mapSubSentenceToVM;
