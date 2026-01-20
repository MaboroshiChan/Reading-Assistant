/** —— 基础枚举/联合：语法角色、语义标签、可视化配色 —— */
export type SyntacticRole =
  | "subject"        // 主语
  | "predicate"      // 谓语核心（动词/系表）
  | "object"         // 宾语/受事
  | "complement"     // 补语（表语/宾补/状补）
  | "modifier"       // 各类状语/修饰语（时间/地点/方式/原因/条件/程度…）
  | "connector"      // 连接词（并列/转折/因果/条件/让步…）
  | "clause"         // 从句壳（名词性/定语/状语等的承载点）
  | "phrase"         // 短语节点（NP/VP/PP/AdjP/AdvP 等）
  | "token";         // 最小词/符号

export type SemanticTag =
  | "cause" | "result" | "condition" | "concession" | "purpose"
  | "contrast" | "transition" | "example" | "definition"
  | "emphasis" | "topic" | "comment" | "time" | "location" | "manner"
  | "evaluation" | "attribution" | "reporting" | "modality"
  | "none";

/** 颜色变体；仅作为“视图建议”，不强制绑定渲染层 */
export type ColorVariant = "blue" | "green" | "yellow" | "gray";

/** 语义角色（深层语义参与者） */
export type SemanticRoleName =
  | "Agent" | "Patient" | "Theme" | "Experiencer" | "Instrument"
  | "Goal" | "Source" | "Location" | "Time" | "Manner" | "Cause" | "Condition" | "None";

/** —— 可选：句法树节点（用于对齐 parser 输出） —— */
export interface SyntaxNode {
  id: string;
  label: string;      // 如 "S" | "VP" | "NP" | "PP" | "CP"
  children?: SyntaxNode[];
}

/** —— 句内最小分析单元（可递归 & 可承载从句） —— */
export interface StructureUnit {
  id: string;
  text: string;                  // 和 start/end 对齐的切片文本；对子树可为拼接文本
  role?: SyntacticRole;          // 句法角色
  semantics?: SemanticTag;       // 语义功能标签
  semRole?: SemanticRoleName;    // 语义参与者（Agent/Patient 等）

  /** 与原句的位置信息（可选但强烈建议，有利于“原文切片高亮”） */

  /** 递归：如果这是一个从句壳（role === "clause" 或 semantics 指示），则承载完整从句分析 */
  clause?: SentenceStructureAnalysis;

  /** 结构递归：短语/从句内部的进一步分解 */
  children?: StructureUnit[];

  /** 质量与来源 */
  confidence?: number;           // 0~1
  source?: "manual" | "model" | "hybrid";

  /** 附加信息（不影响通用逻辑） */
  meta?: Record<string, unknown>;

  /** 视图提示（非必需，供渲染层参考；不强绑定 UI） */
  viewHint?: {
    variant?: ColorVariant;      // 建议配色
    collapsed?: boolean;         // 初始是否折叠子树
    label?: string;              // 自定义右上角/胶囊标签文案
    order?: number;              // 同层显示顺序提示
  };
}

/** —— 顶层：一句话的子结构与语义分析容器 —— */
export interface SentenceStructureAnalysis {
  sentenceId: string;
  text: string;                  // 原句完整文本（用于对齐 & 备用渲染）
  units: StructureUnit[];              // 渲染/交互的主要数据入口（通常一层或数层骨干）

  /** 主干位（便于消费端快速定位，不必每次从 units 里找） */
  backbone?: {
    subjectId?: string;
    predicateId?: string;
    objectId?: string;
    // 某些语言可有多个核心（并列谓语/并列宾语），可以在 units 中表达；这里仅缓存“首选”
  };

  /** 可选：外部句法树（若你接第三方 parser） */
  syntaxTree?: SyntaxNode;

  /** 标签与颜色系统（可覆盖默认映射） */
  legend?: {
    semanticsToVariant?: Partial<Record<SemanticTag, ColorVariant>>;
    roleToVariant?: Partial<Record<SyntacticRole, ColorVariant>>;
    semRoleToVariant?: Partial<Record<SemanticRoleName, ColorVariant>>;
    variantPalette?: Partial<Record<ColorVariant, { bg: string; fg: string; dot: string }>>;
  };

  /** 渲染/交互策略建议（视图层可自由采用/忽略） */
  layoutHint?: {
    density?: "normal" | "dense";
    highlightStrategy?: "semantics-first" | "role-first" | "semantic-role" | "mixed";
    showLabels?: boolean;
    showCaret?: boolean;
    cardMaxWidth?: number;
  };

  /** 溯源与审计 */
  analyzedAt?: string;           // ISO8601
  version?: number;
  confidence?: number;

  /** 质量问题记录（便于 QA 与人手校正） */
  issues?: Array<{
    type: "overlap" | "gap" | "conflict" | "lowConfidence" | "unparsed";
    message: string;
    unitIds?: string[];
  }>;

  /** 协作批注 */
  annotations?: Array<{
    userId: string;
    note: string;
    createdAt: string;          // ISO8601
    targetUnitId?: string;
  }>;

  /** 任意扩展 */
  meta?: Record<string, unknown>;
}

/** —— 推荐的默认颜色映射（与黑底 UI 协调） —— */
export const DefaultVariantPalette: Record<ColorVariant, { bg: string; fg: string; dot: string }> = {
  blue: { bg: "rgba(123,168,255,0.24)", fg: "#dde6ff", dot: "#84a9ff" },
  green: { bg: "rgba(103,232,185,0.22)", fg: "#d2f5ea", dot: "#34d399" },
  yellow: { bg: "rgba(253,224,138,0.24)", fg: "#fef3c7", dot: "#facc15" },
  gray: { bg: "rgba(226,232,240,0.18)", fg: "#e2e8f0", dot: "#94a3b8" },
};

export const DefaultLegend: Required<NonNullable<SentenceStructureAnalysis["legend"]>> = {
  semanticsToVariant: {
    cause: "green",
    result: "green",
    condition: "blue",
    concession: "blue",
    purpose: "green",
    contrast: "blue",
    transition: "blue",
    example: "yellow",
    definition: "yellow",
    emphasis: "yellow",
    topic: "blue",
    comment: "green",
    time: "yellow",
    location: "yellow",
    manner: "yellow",
    evaluation: "yellow",
    attribution: "green",
    reporting: "green",
    modality: "yellow",
    none: "gray",
  },
  roleToVariant: {
    subject: "blue",
    predicate: "green",
    object: "green",
    complement: "yellow",
    modifier: "yellow",
    connector: "blue",
    clause: "gray",
    phrase: "gray",
    token: "gray",
  },
  semRoleToVariant: {
    Agent: "blue",
    Patient: "green",
    Theme: "green",
    Experiencer: "blue",
    Instrument: "yellow",
    Goal: "yellow",
    Source: "yellow",
    Location: "yellow",
    Time: "yellow",
    Manner: "yellow",
    Cause: "green",
    Condition: "blue",
    None: "gray",
  },
  variantPalette: DefaultVariantPalette,
};

/**
 * Determines the visual theme variant for a structural unit based on its metadata.
 * Priority: Semantics > Syntactic Role > Semantic Role.
 *
 * @param u - The structural unit to style.
 * @param legend - Optional custom mapping legend.
 * @returns A color variant name.
 */
export function chooseVariant(
  u: StructureUnit,
  legend: SentenceStructureAnalysis["legend"] = DefaultLegend
): ColorVariant {
  const L = { ...DefaultLegend, ...(legend ?? {}) };
  if (u.semantics && L.semanticsToVariant?.[u.semantics]) return L.semanticsToVariant[u.semantics]!;
  if (u.role && L.roleToVariant?.[u.role]) return L.roleToVariant[u.role]!;
  if (u.semRole && L.semRoleToVariant?.[u.semRole]) return L.semRoleToVariant[u.semRole]!;
  return "gray";
}

/** Type guard for StructureUnit. */
export function isStructureUnit(x: unknown): x is StructureUnit {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return !!x && typeof x === "object" && typeof (x as any).id === "string" && typeof (x as any).text === "string";
}

/** Type guard for SentenceStructureAnalysis. */
export function isSentenceStructureAnalysis(x: unknown): x is SentenceStructureAnalysis {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return !!x && typeof x === "object" && typeof (x as any).sentenceId === "string" &&
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    typeof (x as any).text === "string" && Array.isArray((x as any).units);
}
