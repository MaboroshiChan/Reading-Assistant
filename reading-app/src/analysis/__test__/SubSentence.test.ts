import { describe, expect, it } from "vitest";
import type { SubSentenceAnalysis } from "../structure/SubSentence";
import ExampleSubsentence from "../../../examples/subsentence-example.json";

describe("SubSentenceAnalysis data structure", () => {
  it("should correctly parse example subsentence analysis data", () => {
    const analysis: SubSentenceAnalysis = ExampleSubsentence as SubSentenceAnalysis;

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
