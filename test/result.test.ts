import { describe, expect, it } from "vitest";
import { finalizeResult, parseAiClassification } from "../src/result.js";
import type { DeterministicMatch, Source } from "../src/types.js";

const rulesSource: Source = {
  kind: "action-default",
  path: "rules/default.yml",
};

const databaseMatch: DeterministicMatch = {
  ruleId: "database-change",
  description: "DB schema, migration, seed, destructive DDL",
  pattern: "db/**",
  files: ["db/schema.sql"],
};

describe("parseAiClassification", () => {
  it("Claudeのstructured outputを検証して読み込む", () => {
    const actual = parseAiClassification(
      JSON.stringify({
        verdict: "SELF_MERGE_ALLOWED",
        summary: "UI文言のみの変更です。",
        triggered_rules: [],
        safe_to_self_merge_reason: "容易にrevertできます。",
        human_review_reason: "",
        files_considered: ["src/components/Button.tsx"],
      }),
    );

    expect(actual).toEqual({
      verdict: "SELF_MERGE_ALLOWED",
      summary: "UI文言のみの変更です。",
      triggered_rules: [],
      safe_to_self_merge_reason: "容易にrevertできます。",
      human_review_reason: "",
      files_considered: ["src/components/Button.tsx"],
    });
  });

  const invalidCases = [
    {
      name: "JSONとして壊れている",
      aiJson: "{",
      expected: {
        message: "Claude structured output is not valid JSON",
      },
    },
    {
      name: "verdict が許可値ではない",
      aiJson: JSON.stringify({
        verdict: "SKIPPED_UNSUPPORTED_FORK",
        summary: "判定しました。",
        triggered_rules: [],
        files_considered: ["src/index.ts"],
      }),
      expected: {
        message: "Claude structured output does not match the expected schema",
      },
    },
    {
      name: "summary が文字列ではない",
      aiJson: JSON.stringify({
        verdict: "SELF_MERGE_ALLOWED",
        summary: null,
        triggered_rules: [],
        files_considered: ["src/index.ts"],
      }),
      expected: {
        message: "Claude structured output does not match the expected schema",
      },
    },
    {
      name: "triggered_rules が期待構造ではない",
      aiJson: JSON.stringify({
        verdict: "HUMAN_REVIEW_REQUIRED",
        summary: "判定しました。",
        triggered_rules: [{ rule_id: "database", reason: "DB変更です。" }],
        files_considered: ["db/schema.sql"],
      }),
      expected: {
        message: "Claude structured output does not match the expected schema",
      },
    },
    {
      name: "files_considered が文字列配列ではない",
      aiJson: JSON.stringify({
        verdict: "SELF_MERGE_ALLOWED",
        summary: "判定しました。",
        triggered_rules: [],
        files_considered: [1],
      }),
      expected: {
        message: "Claude structured output does not match the expected schema",
      },
    },
    {
      name: "root に未知の property がある",
      aiJson: JSON.stringify({
        verdict: "SELF_MERGE_ALLOWED",
        summary: "判定しました。",
        triggered_rules: [],
        files_considered: ["src/index.ts"],
        extra: "AIが返した余分な値",
      }),
      expected: {
        message: "Claude structured output does not match the expected schema",
      },
    },
    {
      name: "triggered_rules に未知の property がある",
      aiJson: JSON.stringify({
        verdict: "HUMAN_REVIEW_REQUIRED",
        summary: "判定しました。",
        triggered_rules: [
          {
            rule_id: "public-api-contract-change",
            reason: "公開APIの確認が必要です。",
            files: ["openapi.yml"],
            severity: "high",
          },
        ],
        files_considered: ["openapi.yml"],
      }),
      expected: {
        message: "Claude structured output does not match the expected schema",
      },
    },
  ];

  it.each(invalidCases)("$name 場合はエラーにする", ({ aiJson, expected }) => {
    const actual = (() => {
      try {
        parseAiClassification(aiJson);
      } catch (error) {
        return {
          message: error instanceof Error ? error.message : String(error),
        };
      }

      return {
        message: "エラーが発生しませんでした",
      };
    })();

    expect(actual).toEqual(expected);
  });
});

describe("finalizeResult", () => {
  const cases = [
    {
      name: "決定的ルールがなければAIのSELF_MERGE_ALLOWEDを採用する",
      aiJson: JSON.stringify({
        verdict: "SELF_MERGE_ALLOWED",
        summary: "文言変更のみです。",
        triggered_rules: [],
        files_considered: ["src/components/Button.tsx"],
      }),
      deterministicMatches: [],
      expected: {
        verdict: "SELF_MERGE_ALLOWED",
        aiVerdict: "SELF_MERGE_ALLOWED",
        summary: "文言変更のみです。",
        deterministicMatches: [],
        aiTriggeredRules: [],
        rulesSource,
        filesConsidered: ["src/components/Button.tsx"],
        labelUpdate: {
          shouldUpdate: true,
          addLabel: "self-merge: allowed",
          removeLabel: "review: human-required",
        },
      },
    },
    {
      name: "決定的ルールがあればAIのSELF_MERGE_ALLOWEDを人間レビュー必須へ上書きする",
      aiJson: JSON.stringify({
        verdict: "SELF_MERGE_ALLOWED",
        summary: "文言変更のみです。",
        triggered_rules: [],
        files_considered: ["db/schema.sql"],
      }),
      deterministicMatches: [databaseMatch],
      expected: {
        verdict: "HUMAN_REVIEW_REQUIRED",
        aiVerdict: "SELF_MERGE_ALLOWED",
        summary: "決定的ルールに一致したため、人間レビューが必要です。",
        deterministicMatches: [databaseMatch],
        aiTriggeredRules: [],
        rulesSource,
        filesConsidered: ["db/schema.sql"],
        labelUpdate: {
          shouldUpdate: true,
          addLabel: "review: human-required",
          removeLabel: "self-merge: allowed",
        },
      },
    },
    {
      name: "AIのsemantic ruleを最終結果に残す",
      aiJson: JSON.stringify({
        verdict: "HUMAN_REVIEW_REQUIRED",
        summary: "公開API契約の確認が必要です。",
        triggered_rules: [
          {
            rule_id: "public-api-contract-change",
            reason: "レスポンススキーマが変更されています。",
            files: ["openapi.yml"],
          },
        ],
        files_considered: ["openapi.yml"],
      }),
      deterministicMatches: [],
      expected: {
        verdict: "HUMAN_REVIEW_REQUIRED",
        aiVerdict: "HUMAN_REVIEW_REQUIRED",
        summary: "公開API契約の確認が必要です。",
        deterministicMatches: [],
        aiTriggeredRules: [
          {
            rule_id: "public-api-contract-change",
            reason: "レスポンススキーマが変更されています。",
            files: ["openapi.yml"],
          },
        ],
        rulesSource,
        filesConsidered: ["openapi.yml"],
        labelUpdate: {
          shouldUpdate: true,
          addLabel: "review: human-required",
          removeLabel: "self-merge: allowed",
        },
      },
    },
    {
      name: "AIのJSONが壊れている場合は判定失敗にする",
      aiJson: "{",
      deterministicMatches: [],
      expected: {
        verdict: "AI_CLASSIFICATION_FAILED",
        aiVerdict: null,
        summary:
          "AI判定に失敗したため、この自動判定だけではセルフマージ可否を判断できません。",
        deterministicMatches: [],
        aiTriggeredRules: [],
        rulesSource,
        filesConsidered: [],
        labelUpdate: {
          shouldUpdate: false,
          addLabel: "",
          removeLabel: "",
        },
        error: {
          code: "INVALID_AI_OUTPUT",
          message: "Claude structured output is not valid JSON",
        },
      },
    },
    {
      name: "決定的ルールがあればAIのJSONが壊れていても人間レビュー必須にする",
      aiJson: "{",
      deterministicMatches: [databaseMatch],
      expected: {
        verdict: "HUMAN_REVIEW_REQUIRED",
        aiVerdict: null,
        summary:
          "AI判定には失敗しましたが、決定的ルールに一致したため、人間レビューが必要です。",
        deterministicMatches: [databaseMatch],
        aiTriggeredRules: [],
        rulesSource,
        filesConsidered: ["db/schema.sql"],
        labelUpdate: {
          shouldUpdate: true,
          addLabel: "review: human-required",
          removeLabel: "self-merge: allowed",
        },
        error: {
          code: "INVALID_AI_OUTPUT",
          message: "Claude structured output is not valid JSON",
        },
      },
    },
  ];

  it.each(cases)("$name", ({ aiJson, deterministicMatches, expected }) => {
    const actual = finalizeResult({
      aiJson,
      deterministicMatches,
      rulesSource,
      labels: {
        allowed: "self-merge: allowed",
        humanRequired: "review: human-required",
      },
    });

    expect(actual).toEqual(expected);
  });
});
