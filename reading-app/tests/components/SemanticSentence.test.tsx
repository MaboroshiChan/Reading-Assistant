import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import React from "react";
import { SentenceComponent } from "../../src/components/SentenceComponent";
import type { Sentence } from "../../src/analysis/structure/Sentence";

describe("SentenceComponent", () => {
  const makeSentence = (): Sentence => ({
    id: 1,
    text: "This is a test sentence.",
    function: "Premise",
    type: "Declarative",
    purpose: "To demonstrate a test case",
    mood: "Indicative",
    relation: {
      type: "Justification",
      targetSentenceId: 2,
    },
  });

  it("renders without throwing", () => {
    const sentence = makeSentence();

    expect(() => render(<SentenceComponent sentence={sentence} />)).not.toThrow();
  });
});
