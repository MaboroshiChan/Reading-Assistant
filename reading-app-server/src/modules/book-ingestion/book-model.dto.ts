export type BookModelNodeType = 'person' | 'idea' | 'event' | 'entity' | 'theme';

export type BookModelEntityType = 'organization' | 'place' | 'time' | 'object' | 'other';

export type BookModelIdeaKind = 'claim' | 'belief' | 'question' | 'principle' | 'conflict';

export type BookModelIdeaStatus = 'introduced' | 'expanded' | 'challenged' | 'resolved';

export type BookModelIdeaFlowStatus = 'emerging' | 'developing' | 'contested' | 'stabilized';

export type BookModelRelationType =
  | 'knows'
  | 'supports'
  | 'opposes'
  | 'extends'
  | 'causes'
  | 'participates_in'
  | 'located_in'
  | 'happens_at'
  | 'reflects'
  | 'related_to';

export type BookModelLinkType = 'exact' | 'alias' | 'fuzzy' | 'semantic';

export interface BookModelEvidenceRefDto {
  chapterIndex: number;
  pageIndex?: number;
  pageNumber?: number;
  chapterId?: string;
  passageId?: string;
  sentenceId?: string;
  quote?: string;
}

export interface BookMetaDto {
  title?: string;
  author?: string;
  language?: string;
  totalChapters?: number;
  createdAt: string;
  updatedAt: string;
}

export interface ChapterPersonDto {
  localId: string;
  name: string;
  aliases: string[];
  description?: string;
  roles: string[];
  traits: string[];
  evidence: BookModelEvidenceRefDto[];
}

export interface ChapterIdeaDto {
  localId: string;
  label: string;
  description?: string;
  kind?: BookModelIdeaKind;
  evidence: BookModelEvidenceRefDto[];
}

export interface ChapterEventDto {
  localId: string;
  label: string;
  description?: string;
  participantLocalIds: string[];
  timeHint?: string;
  placeHint?: string;
  evidence: BookModelEvidenceRefDto[];
}

export interface ChapterEntityDto {
  localId: string;
  label: string;
  type: BookModelEntityType;
  description?: string;
  evidence: BookModelEvidenceRefDto[];
}

export interface ChapterThemeDto {
  localId: string;
  label: string;
  strength?: number;
  description?: string;
  evidence: BookModelEvidenceRefDto[];
}

export interface ChapterRelationDto {
  localId: string;
  fromId: string;
  fromType: BookModelNodeType;
  toId: string;
  toType: BookModelNodeType;
  relationType: BookModelRelationType;
  description?: string;
  confidence?: number;
  evidence: BookModelEvidenceRefDto[];
}

export interface ChapterBookModelDto {
  chapterId: string;
  chapterIndex: number;
  snapshotVersion?: number;
  chapterContentHash?: string;
  title?: string;
  summary?: string;
  people: ChapterPersonDto[];
  ideas: ChapterIdeaDto[];
  events: ChapterEventDto[];
  entities: ChapterEntityDto[];
  themes: ChapterThemeDto[];
  relations: ChapterRelationDto[];
  createdAt: string;
}

export interface GlobalPersonDto {
  personId: string;
  canonicalName: string;
  aliases: string[];
  description?: string;
  roles: string[];
  traits: string[];
  firstSeenIn: number;
  lastSeenIn: number;
  mentionedIn: number[];
  evidence: BookModelEvidenceRefDto[];
}

export interface GlobalIdeaDto {
  ideaId: string;
  canonicalLabel: string;
  variants: string[];
  description?: string;
  status?: BookModelIdeaStatus;
  firstSeenIn: number;
  lastSeenIn: number;
  mentionedIn: number[];
  evidence: BookModelEvidenceRefDto[];
}

export interface GlobalEventDto {
  eventId: string;
  canonicalLabel: string;
  description?: string;
  occurredInChapter: number;
  participantIds: string[];
  placeEntityId?: string;
  timeEntityId?: string;
  mentionedIn: number[];
  evidence: BookModelEvidenceRefDto[];
}

export interface GlobalEntityDto {
  entityId: string;
  canonicalLabel: string;
  type: BookModelEntityType;
  aliases: string[];
  description?: string;
  firstSeenIn: number;
  lastSeenIn: number;
  mentionedIn: number[];
  evidence: BookModelEvidenceRefDto[];
}

export interface GlobalThemeDto {
  themeId: string;
  canonicalLabel: string;
  variants: string[];
  strength: number;
  mentionedIn: number[];
  evidence: BookModelEvidenceRefDto[];
}

export interface GlobalRelationDto {
  relationId: string;
  fromId: string;
  fromType: BookModelNodeType;
  toId: string;
  toType: BookModelNodeType;
  relationType: BookModelRelationType;
  description?: string;
  firstSeenIn: number;
  lastSeenIn: number;
  mentionedIn: number[];
  confidence?: number;
  evidence: BookModelEvidenceRefDto[];
}

export interface CharacterArcDto {
  arcId: string;
  personId: string;
  summary: string;
  chapterSpan: number[];
  keyEventIds: string[];
  keyIdeaIds: string[];
}

export interface IdeaFlowDto {
  flowId: string;
  ideaId: string;
  summary: string;
  chapterSpan: number[];
  relatedIdeaIds: string[];
  status?: BookModelIdeaFlowStatus;
}

export interface ChapterToGlobalLinkDto {
  chapterId: string;
  chapterIndex: number;
  localId: string;
  localType: BookModelNodeType;
  globalId: string;
  globalType: BookModelNodeType;
  linkType: BookModelLinkType;
  confidence: number;
}

export interface KeyInformationDto {
  people: GlobalPersonDto[];
  ideas: GlobalIdeaDto[];
  events: GlobalEventDto[];
  entities: GlobalEntityDto[];
  themes: GlobalThemeDto[];
  relations: GlobalRelationDto[];
  arcs: CharacterArcDto[];
  ideaFlows: IdeaFlowDto[];
  links: ChapterToGlobalLinkDto[];
}

export interface GetBookModelResponseDto {
  bookId: string;
  meta: BookMetaDto;
  chapters: ChapterBookModelDto[];
  keyInformation: KeyInformationDto;
}
