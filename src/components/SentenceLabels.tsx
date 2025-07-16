/* eslint-disable @typescript-eslint/no-explicit-any */
import { type SentenceLabels } from "../analysis/structure/Sentence";
import React, { useEffect } from "react";

interface SentenceLabelsProps {
  labels: SentenceLabels;
}

export interface LLMAnalysis {
  id: number;
  sentence: string;
  structure: {
    subject: string,
    predicate: string,
    object: string,
  },
  semantics: {
    semantic_roles: { text_piece: string; type: "concept" | "event" | "entity" | "goal" | "modifier" | "location" }[];
  };
  pragmatics: {
    modality: "factual" | "hypothetical" | "evaluative" | "general truth";
    tone: "neutral" | "analytical" | "emotional" | "assertive" | "doubtful";
    emphasis: boolean;
    focus: string[];
  };
  // 其他字段（structure, discourse, meta）可以继续加
}

export interface HighlighterProps {
  data: LLMAnalysis;
}

//* ------------------------------------------------------------- */
/*  Spacing rules (identical to fromSentenceLabels)              */
/* ------------------------------------------------------------- */
type Kind = "WORD" | "OPEN" | "CLOSE";
//const OPEN  = new Set(["“", "‘", "(", "["]);                     // never space *after*
//const CLOSE = new Set([",", ".", "!", "?", ":", ";", "”", "’", ")", "]"]); // never space *before*

/* ------------------------------------------------------------- */
/*  Component                                                    */
/* ------------------------------------------------------------- */
export const SemanticSentenceLabels: React.FC<SentenceLabelsProps> = ({
  labels,
}) => {
  let lastKind: Kind | "" = "";      // remembers what we just emitted

  /** Emits `node`, inserting a space first only if the two neighbours allow it. */
  const emit = (
    out: React.ReactNode[],
    node: React.ReactNode,
    kind: Kind
  ) => {
    if (
      out.length &&                  // not the first token overall
      lastKind !== "OPEN" &&         // previous token allows a trailing space
      kind !== "CLOSE"          // current token allows a leading space
    ) {
      out.push(" ");
    }
    out.push(node);
    lastKind = kind;
  };

  /** Recursive renderer that applies punctuation logic identical to helper. */
  const render = (
    toks: SentenceLabels,
    path = "r"
  ): React.ReactNode[] => {
    const out: React.ReactNode[] = [];

    toks.forEach((t, idx) => {
      const key = `${path}-${idx}`;

      /* ----------------- plain text leaf ---------------------------- */
      if ("text" in t) {
        emit(
          out,
          <span key={key} className={`token ${t.label ? `label-${t.label}` : ""}`}>{t.text}</span>,
          "WORD"
        );
        return;
      }

      /* ----------------- nested group ------------------------------ */
      const inner = render(t.nested, key);
      const group = (
        /* ← NO whitespace before {inner} or after it → */
        <span key={key} className={`nested-group label-${t.label}`}>{inner}</span>
      );

      switch (t.label) {
        case "parenthetical phrase":         // , phrase ,
          emit(out, ",", "CLOSE");
          emit(out, group, "WORD");
          emit(out, ",", "CLOSE");
          break;

        case "quote":                        // “ phrase , ”
          emit(out, "“", "OPEN");
          emit(out, group, "WORD");
          emit(out, ",", "CLOSE");           // glued inside quotes
          emit(out, "”", "CLOSE");
          break;

        default:                             // all other labels
          emit(out, group, "WORD");
      }
    });

    return out;
  };

  /* Build full sentence; helper always appends final “?” if absent. */
  const nodes = render(labels);
  // emit(nodes, ".", "CLOSE");                 // TODO: This is bug

  return <span className="semantic-sentence-labels">{nodes}</span>;
};

/**
 * 
 * @param props: contains keywords 
 * @returns highlighting components
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
// --------------------------------------------------
// 2. 收集所有关键词 & 焦点词 → phrase 列表
// --------------------------------------------------
/**
 * 提取 LLM 分析结果中的关键词（semantics.keywords）与焦点词（pragmatics.focus），
 * 合并成一个统一的短语列表，并标注来源（keyword / focus）。
 *
 * @param data LLMAnalysis 对象
 * @returns 包含短语和来源的对象数组
 */
export const collectHighlightPhrases = (data: LLMAnalysis): { word: string; source: string }[] => {
  return [
    ...data.semantics.semantic_roles.map(k => ({ word: k.text_piece, source: "keyword" })),
    ...data.pragmatics.focus.map(word => ({ word, source: "focus" })),
  ];
};


export const extractStructureSpans = (
  sentence: string,
  structure: {
    subject?: string;
    predicate?: string;
    object?: string;
  }
): { start: number; end: number; label: string; id: string; linkedBy?: string }[] => {
  const lowerSentence = sentence.toLowerCase();
  const result: { start: number; end: number; label: string; id: string; linkedBy?: string }[] = [];

  const match = (text: string | undefined, label: string, id: string) => {
    if (!text) return;
    const phrase = text.toLowerCase();
    const idx = lowerSentence.indexOf(phrase); // 查找短语在句子中的位置
    if (idx !== -1) {
      result.push({ start: idx, end: idx + phrase.length, label, id }); // 添加 id
    }
  };

  match(structure.subject, "subject", "subj-1");
  match(structure.object, "object", "obj-1");
  match(structure.predicate, "verb", "verb-1");

  // 给动词加 links
  const verb = result.find(r => r.label === "verb");
  if (verb) {
    const linked = result.filter(r => r.label === "subject" || r.label === "object");
    verb.linkedBy = linked.map(l => l.id).join(",");
  }

  return result;
};

export const extractSemanticSpans = (
  sentence: string,
  semantics: {
    semantic_roles: {
      text_piece: string;
      type: "concept" | "event" | "entity" | "goal" | "modifier" | "location" | "agent" | "receiver" | "predicate";
    }[];
  }
): {
  start: number;
  end: number;
  label: string;
  id: string;
  linkedBy?: string;
}[] => {
  const spans: {
    start: number;
    end: number;
    label: string;
    id: string;
    linkedBy?: string;
  }[] = [];

  const lower = sentence.toLowerCase();

  // 记录 id 分配
  const roleCount: Record<string, number> = {};
  const predicateIndices: number[] = [];

  semantics.semantic_roles.forEach(({ text_piece, type }) => {
    const phrase = text_piece.toLowerCase();
    let pos = 0;

    while (true) {
      const found = lower.indexOf(phrase, pos);
      if (found === -1) break;

      const count = (roleCount[type] = (roleCount[type] || 0) + 1);
      const id = `semantic-${type}-${count}`;
      const label = `semantic-${type}`;

      const span = {
        start: found,
        end: found + phrase.length,
        label,
        id,
      };

      spans.push(span);

      // 如果是谓词，记录下标
      if (type === "predicate") {
        predicateIndices.push(spans.length - 1);
      }

      pos = found + phrase.length;
    }
  });

  // 给每个 predicate 填上 linkedBy → 指向 subject/object id
  predicateIndices.forEach(predIdx => {
    const predicateSpan = spans[predIdx];
    const linkedIds = spans
      .filter(s => s.label === "semantic-subject" || s.label === "semantic-object")
      .map(s => s.id);
    predicateSpan.linkedBy = linkedIds.join(",");
  });

  return spans;
};


interface UnifiedSpan {
  start: number;
  end: number;
  label: string[];      // 多标签支持
  id?: string;          // 给需要联动的 span 设置 ID
  linkedBy?: string;    // 给谓词 span 设置 data-links
}

export const extractUnifiedSpans = (
  sentence: string,
  structure: { subject: string; predicate: string; object: string },
  semantics: {
    semantic_roles: {
      text_piece: string;
      type: "concept" | "event" | "entity" | "goal" | "modifier" | "location" | "subject" | "object" | "predicate";
    }[];
  }
): UnifiedSpan[] => {
  const lower = sentence.toLowerCase();
  const spans: UnifiedSpan[] = [];
  const idMap: Record<string, string> = {};
  let idCounter = 1;

  // Helper to add or merge spans
  const addOrMergeSpan = (start: number, end: number, label: string, isStructural = false): string | undefined => {
    const existing = spans.find(s => s.start === start && s.end === end);
    if (existing) {
      if (!existing.label.includes(label)) existing.label.push(label);
      return existing.id;
    } else {
      const newSpan: UnifiedSpan = {
        start,
        end,
        label: [label],
      };
      if (isStructural || label.startsWith("structure-")) {
        const newId = `span-${idCounter++}`;
        newSpan.id = newId;
        idMap[label] = newId;
        return newId;
      }
      spans.push(newSpan);
      return undefined;
    }
  };

  // --- 1. Structure: subject / predicate / object
  const structureRoles: { value: string; label: string }[] = [
    { value: structure.subject, label: "structure-subject" },
    { value: structure.predicate, label: "structure-predicate" },
    { value: structure.object, label: "structure-object" },
  ];

  structureRoles.forEach(({ value, label }) => {
    if (!value) return;
    const idx = lower.indexOf(value.toLowerCase());
    if (idx !== -1) {
      addOrMergeSpan(idx, idx + value.length, label, true);
    }
  });

  // --- 2. Semantics
  semantics.semantic_roles.forEach(({ text_piece, type }) => {
    const label = `semantic-${type}`;
    const phrase = text_piece.toLowerCase();
    let pos = 0;
    while (pos < lower.length) {
      const idx = lower.indexOf(phrase, pos);
      if (idx === -1) break;
      addOrMergeSpan(idx, idx + phrase.length, label);
      pos = idx + phrase.length;
    }
  });

  // --- 3. Add linkedBy to predicate spans
  spans.forEach(span => {
    if (span.label.includes("structure-predicate")) {
      const linkedIds = spans
        .filter(s =>
          s.label.includes("structure-subject") ||
          s.label.includes("structure-object")
        )
        .map(s => s.id)
        .filter(Boolean);
      if (linkedIds.length) {
        span.linkedBy = linkedIds.join(",");
      }
    }
  });

  return spans;
};

// --------------------------------------------------
// 5. 根据 layers 构建嵌套 React 节点
// --------------------------------------------------
export const buildHighlightedNodes = (
  sentence: string,
  layers: string[][]
): React.ReactNode[] => {
  const result: React.ReactNode[] = [];
  let i = 0;

  while (i < sentence.length) {
    const active = layers[i];
    let j = i + 1;
    while (
      j < sentence.length &&
      JSON.stringify(layers[j]) === JSON.stringify(active)
    ) {
      j++;
    }

    const chunk = sentence.slice(i, j);
    let node: React.ReactNode = chunk;

    for (const label of [...active].reverse()) {
      node = (
        <span className={`highlight highlight-${label}`} key={`${i}-${label}`}>
          {node}
        </span>
      );
    }

    result.push(<React.Fragment key={i}>{node}</React.Fragment>);
    i = j;
  }

  return result;
};

// --------------------------------------------------
// 6. 主组件（整合）
// --------------------------------------------------
export const Highlighter: React.FC<{ data: LLMAnalysis }> = ({ data }) => {
  const { sentence, structure, semantics } = data;

  const spans: UnifiedSpan[] = extractUnifiedSpans(sentence, structure, semantics);
  spans.sort((a, b) => a.start - b.start);

  const highlightedNodes: React.ReactNode[] = [];
  let cursor = 0;

  for (const span of spans) {
    if (cursor < span.start) {
      highlightedNodes.push(<span key={cursor}>{sentence.slice(cursor, span.start)}</span>);
    }

    const spanText = sentence.slice(span.start, span.end);
    const classNames = span.label.map(l => `highlight ${l}`).join(" ");
    highlightedNodes.push(
      <span
        key={`${span.start}-${span.end}`}
        className={classNames}
        id={span.id}
        data-links={span.linkedBy}
      >
        {spanText}
      </span>
    );
    cursor = span.end;
  }

  if (cursor < sentence.length) {
    highlightedNodes.push(<span key={cursor}>{sentence.slice(cursor)}</span>);
  }

  useEffect(() => {
    const container = document.querySelector(".highlighted-sentence");
    if (!container) return;
    const all = container.querySelectorAll(".highlight");

    all.forEach(el => {
      el.addEventListener("mouseenter", () => {
        el.classList.add("hovered");
        const links = el.getAttribute("data-links")?.split(",") ?? [];
        links.forEach(id => {
          const target = document.getElementById(id);
          if (target) target.classList.add("hovered");
        });
      });

      el.addEventListener("mouseleave", () => {
        all.forEach(e => e.classList.remove("hovered"));
      });
    });

    return () => {
      all.forEach(el => {
        const clone = el.cloneNode(true);
        el.replaceWith(clone);
      });
    };
  }, []);

  return <p className="highlighted-sentence">{highlightedNodes}</p>;
};