import { describe, expect, it } from "vitest";
import type { SubSentenceAnalysis } from "../../src/model/structure/SubSentence";

describe("SubSentenceAnalysis data structure", () => {
  it("should correctly parse example subsentence analysis data", () => {
    const analysis: SubSentenceAnalysis = {
      sentenceId: "s-001",
      text: "The most basic kind of conversation involves two people who are talking to each other.",
      units: [
        {
          id: "u1",
          text: "The most basic kind of conversation",
          role: "subject",
          children: [
            { id: "u1-1", text: "The", role: "token" },
            { id: "u1-2", text: "most basic", role: "modifier" },
            { id: "u1-3", text: "kind", role: "token" },
            { id: "u1-4", text: "of conversation", role: "modifier", viewHint: { label: "SUBJ" } },
          ],
          viewHint: { label: "SUBJ" },
        },
        {
          id: "u2",
          text: "involves",
          role: "predicate",
        },
        {
          id: "u3",
          text: "two people who are talking to each other",
          role: "object",
          children: [
            {
              id: "u3-1",
              text: "two people",
              role: "token",
            },
            {
              id: "u3-rc",
              text: "who are talking to each other",
              role: "clause",
              clause: {
                sentenceId: "s-001-rc1",
                text: "who are talking to each other",
                units: [
                  { id: "rc-u1", text: "who", role: "subject" },
                  { id: "rc-u2", text: "are talking", role: "predicate" },
                  { id: "rc-u3", text: "to each other", role: "modifier" },
                ],
                backbone: { subjectId: "rc-u1" },
              },
            },
          ],
        },
      ],
      backbone: {
        subjectId: "u1",
        predicateId: "u2",
        objectId: "u3",
      },
      layoutHint: {
        highlightStrategy: "semantic-role",
        showLabels: true,
        cardMaxWidth: 560,
      },
      meta: { note: "Sample data" },
    };

    expect(analysis.sentenceId).toBe("s-001");
    expect(analysis.text).toContain("conversation involves two people");
    expect(analysis.units).toHaveLength(3);

    const [subjectUnit, predicateUnit, objectUnit] = analysis.units;

    expect(subjectUnit?.role).toBe("subject");
    expect(subjectUnit?.children).toHaveLength(4);
    expect(subjectUnit?.viewHint?.label).toBe("SUBJ");

    expect(predicateUnit?.role).toBe("predicate");
    expect(predicateUnit?.text).toBe("involves");

    expect(objectUnit?.role).toBe("object");
    expect(objectUnit?.children).toHaveLength(2);

    const relativeClause = objectUnit?.children?.find((child) => child.id === "u3-rc");
    expect(relativeClause?.role).toBe("clause");
    expect(relativeClause?.clause?.sentenceId).toBe("s-001-rc1");
    expect(relativeClause?.clause?.units).toHaveLength(3);
    expect(relativeClause?.clause?.backbone?.subjectId).toBe("rc-u1");

    expect(analysis.backbone).toMatchObject({
      subjectId: "u1",
      predicateId: "u2",
      objectId: "u3",
    });

    expect(analysis.layoutHint).toMatchObject({
      highlightStrategy: "semantic-role",
      showLabels: true,
      cardMaxWidth: 560,
    });

    expect(analysis.meta).toHaveProperty("note");
  });
});
