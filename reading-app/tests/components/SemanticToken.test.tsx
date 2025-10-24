import { describe, expect, it } from "vitest";
import { chooseVariant, type SubUnit } from "../../src/analysis/structure/SubSentence";

describe("chooseVariant", () => {
  const baseUnit: SubUnit = {
    id: "u1",
    text: "example token",
    role: "token",
  };

  it("prefers semantic tag mappings when present", () => {
    const unit: SubUnit = {
      ...baseUnit,
      semantics: "cause",
    };

    expect(chooseVariant(unit)).toBe("green");
  });

  it("falls back to role mappings when semantic tag absent", () => {
    const unit: SubUnit = {
      ...baseUnit,
      role: "subject",
      semantics: undefined,
    };

    expect(chooseVariant(unit)).toBe("blue");
  });

  it("returns gray when no mappings match", () => {
    const unit: SubUnit = {
      ...baseUnit,
      role: undefined,
      semantics: undefined,
      semRole: undefined,
    };

    expect(chooseVariant(unit)).toBe("gray");
  });
});
