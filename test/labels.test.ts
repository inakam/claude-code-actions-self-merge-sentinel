import { describe, expect, it } from "vitest";
import { labelUpdateForVerdict } from "../src/labels.js";

describe("labelUpdateForVerdict", () => {
  const cases = [
    {
      name: "セルフマージ可なら allowed を付けて human-required を外す",
      verdict: "SELF_MERGE_ALLOWED" as const,
      expected: {
        shouldUpdate: true,
        addLabel: "self-merge: allowed",
        removeLabel: "review: human-required",
      },
    },
    {
      name: "人間レビュー必須なら human-required を付けて allowed を外す",
      verdict: "HUMAN_REVIEW_REQUIRED" as const,
      expected: {
        shouldUpdate: true,
        addLabel: "review: human-required",
        removeLabel: "self-merge: allowed",
      },
    },
    {
      name: "AI失敗ならラベルを触らない",
      verdict: "AI_CLASSIFICATION_FAILED" as const,
      expected: {
        shouldUpdate: false,
        addLabel: "",
        removeLabel: "",
      },
    },
    {
      name: "非対応forkならラベルを触らない",
      verdict: "SKIPPED_UNSUPPORTED_FORK" as const,
      expected: {
        shouldUpdate: false,
        addLabel: "",
        removeLabel: "",
      },
    },
  ];

  it.each(cases)("$name", ({ verdict, expected }) => {
    const actual = labelUpdateForVerdict(verdict, {
      allowed: "self-merge: allowed",
      humanRequired: "review: human-required",
    });

    expect(actual).toEqual(expected);
  });
});
