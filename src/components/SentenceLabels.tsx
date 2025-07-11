/* eslint-disable @typescript-eslint/no-explicit-any */
import { type SentenceLabels } from "../analysis/structure/Sentence";
import React, { useEffect } from "react";

interface SentenceLabelsProps {
  labels: SentenceLabels;
}

export interface LLMAnalysis {
  sentence: string;
  semantics: {
    keywords: { word: string; type: "concept" | "event" | "entity" | "goal" | "modifier" }[];
    semantic_roles: {
      agent: string;
      patient: string;
      instrument?: string;
    };
    main_verb: string;
    proposition: string;
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
 * These functions turns json labeling into react components, including highlighting and cards
 * The component should search keywords and do highlighting jobs
 */

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
    ...data.semantics.keywords.map(k => ({ word: k.word, source: "keyword" })),
    ...data.pragmatics.focus.map(word => ({ word, source: "focus" })),
  ];
};


// --------------------------------------------------
// 3. 查找所有匹配区间（支持短语、重叠）
// --------------------------------------------------
/**
 * 在句子中查找每个短语的所有出现位置（支持重叠匹配），并返回起止位置及标签。
 *
 * @param sentence 原始句子
 * @param phrases 所有短语及其来源标签
 * @returns 所有匹配片段的位置数组（含 start, end, label）
 */
export const findHighlightSpans = (
  sentence: string,
  phrases: { word: string; source: string }[]
): { start: number; end: number; label: string }[] => {
  const result: { start: number; end: number; label: string }[] = [];
  const lowerSentence = sentence.toLowerCase();

  for (const { word, source } of phrases) {
    const phrase = word.toLowerCase();
    let index = 0;
    while (index < lowerSentence.length) {
      const found = lowerSentence.indexOf(phrase, index);
      if (found === -1) break;
      result.push({ start: found, end: found + phrase.length, label: source });
      index = found + 1;
    }
  }

  result.sort((a, b) =>
    a.start !== b.start ? a.start - b.start : b.end - a.end
  );
  return result;
};


// --------------------------------------------------
// 4. 把 spans 映射为字符层 labels（二维数组）
// --------------------------------------------------
export const buildHighlightLayers = (
  sentenceLength: number,
  spans: { start: number; end: number; label: string }[]
): string[][] => {
  const layers: string[][] = Array.from({ length: sentenceLength }, () => []);
  spans.forEach(({ start, end, label }) => {
    for (let i = start; i < end; i++) {
      layers[i].push(label);
    }
  });
  return layers;
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
export const Highlighter: React.FC<HighlighterProps> = ({ data }) => {
  const { sentence } = data;

  const phrases: {
    word: string;
    source: string;
  }[] = collectHighlightPhrases(data);
  const spans:  {
    start: number;
    end: number;
    label: string;
}[] = findHighlightSpans(sentence, phrases);
  const layers: string[][] = buildHighlightLayers(sentence.length, spans);
  const nodes: React.ReactNode[] = buildHighlightedNodes(sentence, layers);

  const containerSelector = ".highlighted-sentence"

  useEffect(() => {
    // SSR 安全检查
    if (typeof window === "undefined") return;

    // 获取容器元素
    const container: any = document.querySelector(containerSelector);
    if (!container) return;

    // 获取所有 .highlight 元素
    const elements = container.querySelectorAll(".highlight");

    // 为每个元素添加 hover 监听器
    elements.forEach((el: { addEventListener: (arg0: string, arg1: { (): void; (): void; }) => void; classList: { add: (arg0: string) => void; }; dataset: { links: { split: (arg0: string) => never[]; }; group: any; }; }) => {
      el.addEventListener("mouseenter", () => {
        el.classList.add("hovered");

        // 高亮 data-links 指向的所有元素
        const links = el.dataset.links?.split(",") || [];
        links.forEach((id: string) => {
          const target = document.getElementById(id);
          if (target) target.classList.add("hovered");
        });

        // 高亮 data-group 同组元素
        const group = el.dataset.group;
        if (group) {
          container.querySelectorAll(`[data-group='${group}']`).forEach((e: { classList: { add: (arg0: string) => any; }; }) =>
            e.classList.add("hovered")
          );
        }
      });

      el.addEventListener("mouseleave", () => {
        // 清除所有高亮
        container
          .querySelectorAll(".highlight")
          .forEach((e: { classList: { remove: (arg0: string) => any; }; }) => e.classList.remove("hovered"));
      });
    });

    // 清理函数：组件卸载时移除监听器（可选，也可用 cloneNode 方式）
    return () => {
      elements.forEach((el: { cloneNode: (arg0: boolean) => any; replaceWith: (arg0: any) => void; }) => {
        const clone = el.cloneNode(true);
        el.replaceWith(clone);
      });
    };
  }, [containerSelector]); // 依赖项可以设为容器选择器
  

  return <p className="highlighted-sentence">{nodes}</p>;
};