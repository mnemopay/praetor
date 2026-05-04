import { describe, it, expect } from "vitest";
import { createPatch } from "diff";
import { applyUnifiedDiff, parseUnifiedDiff } from "./unified_diff.js";

describe("parseUnifiedDiff", () => {
  it("parses a single-hunk patch", () => {
    const patch = createPatch("a.txt", "foo\nbar\n", "foo\nBAZ\n");
    const hunks = parseUnifiedDiff(patch);
    expect(hunks).toHaveLength(1);
    expect(hunks[0].oldStart).toBe(1);
    expect(hunks[0].lines.some((l) => l.startsWith("+BAZ"))).toBe(true);
    expect(hunks[0].lines.some((l) => l.startsWith("-bar"))).toBe(true);
  });

  it("parses a multi-hunk patch", () => {
    const before = ["a", "b", "c", "d", "e", "f", "g", "h", "i", "j", "k", "l", "m"].join("\n") + "\n";
    const after = ["a", "B", "c", "d", "e", "f", "g", "h", "i", "j", "k", "L", "m"].join("\n") + "\n";
    const patch = createPatch("multi.txt", before, after);
    const hunks = parseUnifiedDiff(patch);
    expect(hunks.length).toBeGreaterThanOrEqual(1);
  });

  it("handles patches with no hunks (empty diff)", () => {
    const patch = createPatch("a.txt", "same\n", "same\n");
    expect(parseUnifiedDiff(patch)).toEqual([]);
  });
});

describe("applyUnifiedDiff", () => {
  it("applies a simple substitution", () => {
    const before = "foo\nbar\nbaz\n";
    const after = "foo\nBAR\nbaz\n";
    const patch = createPatch("a.txt", before, after);
    expect(applyUnifiedDiff(before, patch)).toBe(after);
  });

  it("applies multi-hunk patches in the correct order", () => {
    const before = ["a", "b", "c", "d", "e", "f", "g", "h", "i", "j", "k", "l", "m", "n", "o"].join("\n") + "\n";
    const after = ["a", "B", "c", "d", "e", "f", "g", "h", "i", "j", "k", "l", "m", "N", "o"].join("\n") + "\n";
    const patch = createPatch("multi.txt", before, after);
    expect(applyUnifiedDiff(before, patch)).toBe(after);
  });

  it("returns null when context lines do not match", () => {
    const before = "foo\nbar\nbaz\n";
    const drifted = "foo\nWRONG\nbaz\n";
    const patch = createPatch("a.txt", before, "foo\nBAR\nbaz\n");
    expect(applyUnifiedDiff(drifted, patch)).toBeNull();
  });

  it("preserves a missing trailing newline", () => {
    const before = "foo\nbar"; // no trailing newline
    const after = "foo\nBAR";
    const patch = createPatch("a.txt", before, after);
    const result = applyUnifiedDiff(before, patch);
    expect(result).toBe(after);
    expect(result?.endsWith("\n")).toBe(false);
  });

  it("preserves a present trailing newline", () => {
    const before = "foo\nbar\n";
    const after = "foo\nBAR\n";
    const patch = createPatch("a.txt", before, after);
    const result = applyUnifiedDiff(before, patch);
    expect(result?.endsWith("\n")).toBe(true);
  });

  it("supports adding lines without removing any", () => {
    const before = "foo\nbar\n";
    const after = "foo\nbar\nbaz\n";
    const patch = createPatch("a.txt", before, after);
    expect(applyUnifiedDiff(before, patch)).toBe(after);
  });

  it("supports removing lines without adding any", () => {
    const before = "foo\nbar\nbaz\n";
    const after = "foo\nbaz\n";
    const patch = createPatch("a.txt", before, after);
    expect(applyUnifiedDiff(before, patch)).toBe(after);
  });

  it("returns the source unchanged when the patch has no hunks", () => {
    const source = "no change\n";
    expect(applyUnifiedDiff(source, "")).toBe(source);
  });

  it("handles \\r\\n line endings on input", () => {
    const before = "foo\r\nbar\r\n";
    const expected = "foo\nBAR\n";
    const patch = createPatch("a.txt", "foo\nbar\n", expected);
    // The applier normalizes input line endings to \n; the canonical
    // expected output uses \n.
    expect(applyUnifiedDiff(before, patch)).toBe(expected);
  });
});
