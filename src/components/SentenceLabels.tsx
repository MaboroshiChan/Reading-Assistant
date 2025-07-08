import { type SentenceLabels } from "../analysis/structure/Sentence";
import React from "react";

interface SentenceLabelsProps {
  labels: SentenceLabels;
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
      kind      !== "CLOSE"          // current token allows a leading space
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