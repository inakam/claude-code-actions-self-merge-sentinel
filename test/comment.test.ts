import { describe, expect, it } from "vitest";
import { renderComment } from "../src/comment.js";
import type { FinalResult } from "../src/types.js";

describe("renderComment", () => {
  const cases: Array<{ name: string; result: FinalResult; expected: string }> = [
    {
      name: "rules-only の人間レビュー必須コメントを生成する",
      result: {
        verdict: "HUMAN_REVIEW_REQUIRED",
        aiVerdict: "HUMAN_REVIEW_REQUIRED",
        summary: "`database-change` に一致する変更があるため、人間レビューが必要です。",
        deterministicMatches: [
          {
            ruleId: "database-change",
            description: "DB schema, migration, seed, destructive DDL",
            pattern: "db/**",
            files: ["db/schema.sql"],
          },
        ],
        aiTriggeredRules: [
          {
            rule_id: "hard-to-rollback-change",
            reason: "DB変更はrollbackしても影響が残る可能性があります。",
            files: ["db/schema.sql"],
          },
        ],
        rulesSource: {
          kind: "action-default",
          path: "rules/default.yml",
        },
        filesConsidered: ["db/schema.sql"],
        labelUpdate: {
          shouldUpdate: true,
          addLabel: "review: human-required",
          removeLabel: "self-merge: allowed",
        },
      },
      expected: `<!-- self-merge-sentinel -->

## セルフマージ判定: 人間レビュー必須

\`database-change\` に一致する変更があるため、人間レビューが必要です。

**判定:** \`HUMAN_REVIEW_REQUIRED\`

<details>
<summary>判定の詳細</summary>

### Rules設定

- source: \`action-default:rules/default.yml\`

### 決定的ルール

- rule_id: \`database-change\` / pattern: \`db/**\` / files: \`db/schema.sql\`

### AI triggered rules

- rule_id: \`hard-to-rollback-change\` / files: \`db/schema.sql\` / reason: DB変更はrollbackしても影響が残る可能性があります。

### AI判定

- \`HUMAN_REVIEW_REQUIRED\`

### 考慮したファイル

- \`db/schema.sql\`

</details>
`,
    },
    {
      name: "AI triggered rules の理由をエスケープする",
      result: {
        verdict: "HUMAN_REVIEW_REQUIRED",
        aiVerdict: "HUMAN_REVIEW_REQUIRED",
        summary: "AIが危険な変更と判定しました。",
        deterministicMatches: [],
        aiTriggeredRules: [
          {
            rule_id: "dangerous-change",
            reason: "</details>\n@team",
            files: ["src/index.ts"],
          },
        ],
        rulesSource: {
          kind: "repository",
          path: ".github/self-merge-rules.yml",
        },
        filesConsidered: ["src/index.ts"],
        labelUpdate: {
          shouldUpdate: true,
          addLabel: "review: human-required",
          removeLabel: "self-merge: allowed",
        },
      },
      expected: `<!-- self-merge-sentinel -->

## セルフマージ判定: 人間レビュー必須

AIが危険な変更と判定しました。

**判定:** \`HUMAN_REVIEW_REQUIRED\`

<details>
<summary>判定の詳細</summary>

### Rules設定

- source: \`repository:.github/self-merge-rules.yml\`

### AI triggered rules

- rule_id: \`dangerous-change\` / files: \`src/index.ts\` / reason: &lt;/details&gt;
&#64;team

### AI判定

- \`HUMAN_REVIEW_REQUIRED\`

### 考慮したファイル

- \`src/index.ts\`

</details>
`,
    },
    {
      name: "セルフマージ可コメントを生成する",
      result: {
        verdict: "SELF_MERGE_ALLOWED",
        aiVerdict: "SELF_MERGE_ALLOWED",
        summary: "UI文言のみの変更です。",
        deterministicMatches: [],
        aiTriggeredRules: [],
        rulesSource: {
          kind: "repository",
          path: ".github/self-merge-rules.yml",
        },
        filesConsidered: ["src/components/Button.tsx"],
        labelUpdate: {
          shouldUpdate: true,
          addLabel: "self-merge: allowed",
          removeLabel: "review: human-required",
        },
      },
      expected: `<!-- self-merge-sentinel -->

## セルフマージ判定: セルフマージ可

UI文言のみの変更です。

**判定:** \`SELF_MERGE_ALLOWED\`

<details>
<summary>判定の詳細</summary>

### Rules設定

- source: \`repository:.github/self-merge-rules.yml\`

### AI判定

- \`SELF_MERGE_ALLOWED\`

### 考慮したファイル

- \`src/components/Button.tsx\`

</details>
`,
    },
    {
      name: "AI失敗コメントではラベル未更新とエラーを明記する",
      result: {
        verdict: "AI_CLASSIFICATION_FAILED",
        aiVerdict: null,
        summary:
          "AI判定に失敗したため、この自動判定だけではセルフマージ可否を判断できません。",
        deterministicMatches: [],
        aiTriggeredRules: [],
        rulesSource: {
          kind: "action-default",
          path: "rules/default.yml",
        },
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
      expected: `<!-- self-merge-sentinel -->

## セルフマージ判定: 判定失敗

AI判定に失敗したため、この自動判定だけではセルフマージ可否を判断できません。

**判定:** \`AI_CLASSIFICATION_FAILED\`

ラベルは更新していません。

<details>
<summary>判定の詳細</summary>

### Rules設定

- source: \`action-default:rules/default.yml\`

### エラー

- \`INVALID_AI_OUTPUT\`: Claude structured output is not valid JSON

</details>
`,
    },
  ];

  it.each(cases)("$name", ({ result, expected }) => {
    const actual = renderComment(result, "<!-- self-merge-sentinel -->");

    expect(actual).toEqual(expected);
  });
});
