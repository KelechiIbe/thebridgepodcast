import { describe, expect, it } from "vitest";
import { checkJson, fitsStrictMode, schemaComplexity } from "./jsonCheck";
import { EDIT_JSON_SCHEMA, SCRIPT_JSON_SCHEMA } from "./aiSchema";

describe("AI schema checks", () => {
  it("keeps the big schemas out of Claude's strict mode", () => {
    expect(schemaComplexity(EDIT_JSON_SCHEMA).optional).toBeGreaterThan(24);
    expect(fitsStrictMode(EDIT_JSON_SCHEMA)).toBe(false);
    expect(fitsStrictMode(SCRIPT_JSON_SCHEMA)).toBe(false);
    const small = { type: "object", additionalProperties: false, required: ["a"], properties: { a: { type: "string" } } };
    expect(fitsStrictMode(small)).toBe(true);
  });

  it("reports missing, mistyped and out-of-list values, and drops unknown keys", () => {
    const value: any = {
      title: "T",
      summary: 3,
      personas: [],
      chapters: [{ title: "C", cue: "drumroll", lines: [{ speaker: "a", kind: "studio", text: "x", cards: [{ type: "stat" }], poll: null, flags: [], extra: 1 }] }],
      anonymisation: [],
    };
    const errs = checkJson(value, SCRIPT_JSON_SCHEMA);
    expect(errs).toContain("$.widgets is missing");
    expect(errs).toContain("$.summary should be string, not integer");
    expect(errs.some((e) => e.startsWith("$.chapters[0].cue should be one of"))).toBe(true);
    expect(errs).toContain("$.chapters[0].lines[0].cards[0].anchor is missing");
    expect(value.chapters[0].lines[0].extra).toBeUndefined();
  });

  it("accepts a poll or null where either is allowed", () => {
    const line = { speaker: "a", kind: "studio", text: "x", cards: [], flags: [] };
    const doc = (poll: unknown) => ({ title: "T", summary: "", personas: [], anonymisation: [], widgets: [], chapters: [{ title: "C", cue: "none", lines: [{ ...line, poll }] }] });
    expect(checkJson(doc(null), SCRIPT_JSON_SCHEMA)).toEqual([]);
    expect(checkJson(doc({ question: "Q", options: ["a", "b"], answer: 1, why: "w" }), SCRIPT_JSON_SCHEMA)).toEqual([]);
    expect(checkJson(doc("yes"), SCRIPT_JSON_SCHEMA)[0]).toMatch(/poll doesn't match/);
  });
});
