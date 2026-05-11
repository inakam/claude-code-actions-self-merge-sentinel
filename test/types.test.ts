import { describe, expect, it } from "vitest";
import type { FinalResult, RuleConfig } from "../src/types.js";

describe("RuleConfig", () => {
  it("rules-only 設定の最小構造を表現できる", () => {
    const rules: RuleConfig = {
      version: 1,
      description: "迷う場合は人間レビュー必須です。",
      defaultVerdict: "HUMAN_REVIEW_REQUIRED",
      reviewRequiredRules: [
        {
          id: "database-change",
          description: "DB schema changes",
          match: {
            paths: ["db/**", "**/schema.sql"],
          },
        },
        {
          id: "foundational-library-change",
          description: "Adds a foundational library",
          match: {
            semantic: true,
          },
        },
      ],
    };

    expect(rules).toEqual({
      version: 1,
      description: "迷う場合は人間レビュー必須です。",
      defaultVerdict: "HUMAN_REVIEW_REQUIRED",
      reviewRequiredRules: [
        {
          id: "database-change",
          description: "DB schema changes",
          match: {
            paths: ["db/**", "**/schema.sql"],
          },
        },
        {
          id: "foundational-library-change",
          description: "Adds a foundational library",
          match: {
            semantic: true,
          },
        },
      ],
    });
  });
});

describe("FinalResult", () => {
  it("rulesSource を持つ最終判定結果を表現できる", () => {
    const result: FinalResult = {
      verdict: "HUMAN_REVIEW_REQUIRED",
      aiVerdict: "SELF_MERGE_ALLOWED",
      summary: "決定的ルールに一致したため、人間レビューが必要です。",
      deterministicMatches: [
        {
          ruleId: "database-change",
          description: "DB schema changes",
          pattern: "db/**",
          files: ["db/schema.sql"],
        },
      ],
      aiTriggeredRules: [],
      rulesSource: { kind: "action-default", path: "rules/default.yml" },
      filesConsidered: ["db/schema.sql"],
      labelUpdate: {
        shouldUpdate: true,
        addLabel: "review: human-required",
        removeLabel: "self-merge: allowed",
      },
    };

    expect(result).toEqual({
      verdict: "HUMAN_REVIEW_REQUIRED",
      aiVerdict: "SELF_MERGE_ALLOWED",
      summary: "決定的ルールに一致したため、人間レビューが必要です。",
      deterministicMatches: [
        {
          ruleId: "database-change",
          description: "DB schema changes",
          pattern: "db/**",
          files: ["db/schema.sql"],
        },
      ],
      aiTriggeredRules: [],
      rulesSource: { kind: "action-default", path: "rules/default.yml" },
      filesConsidered: ["db/schema.sql"],
      labelUpdate: {
        shouldUpdate: true,
        addLabel: "review: human-required",
        removeLabel: "self-merge: allowed",
      },
    });
  });
});
