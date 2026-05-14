import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  parseChangedFiles,
  runMain,
  skippedForkResult,
  tryUpsertComment,
} from "../src/main.js";

const actionState = vi.hoisted(() => ({
  outputs: [] as { name: string; value: string }[],
  existingComments: [] as { id: number; body?: string | null }[],
  comments: [] as { issueNumber: number; body: string }[],
  updatedComments: [] as { commentId: number; body: string }[],
  labels: [] as { issueNumber: number; labels: string[] }[],
  removedLabels: [] as { issueNumber: number; name: string }[],
}));

vi.mock("@actions/core", () => ({
  getInput: vi.fn((name: string) => {
    const inputs: Record<string, string> = {
      github_token: "test-token",
      comment_marker: "<!-- self-merge-sentinel -->",
      allowed_label: "self-merge: allowed",
      human_required_label: "review: human-required",
    };

    return inputs[name] ?? "";
  }),
  setOutput: vi.fn((name: string, value: string) => {
    actionState.outputs.push({ name, value });
  }),
  warning: vi.fn(),
  setFailed: vi.fn(),
}));

vi.mock("@actions/github", () => ({
  context: {
    repo: {
      owner: "inakam",
      repo: "claude-code-actions-self-merge-sentinel",
    },
  },
  getOctokit: vi.fn(() => ({
    rest: {
      issues: {
        listComments: vi.fn(async () => ({ data: actionState.existingComments })),
        createComment: vi.fn(async (input: { issue_number: number; body: string }) => {
          actionState.comments.push({
            issueNumber: input.issue_number,
            body: input.body,
          });

          return {
            data: { html_url: "https://github.example/comment/1" },
          };
        }),
        updateComment: vi.fn(async (input: { comment_id: number; body: string }) => {
          actionState.updatedComments.push({
            commentId: input.comment_id,
            body: input.body,
          });

          return {
            data: { html_url: "https://github.example/comment/1" },
          };
        }),
        getLabel: vi.fn(async () => ({ data: {} })),
        createLabel: vi.fn(async () => ({ data: {} })),
        addLabels: vi.fn(async (input: { issue_number: number; labels: string[] }) => {
          actionState.labels.push({
            issueNumber: input.issue_number,
            labels: input.labels,
          });

          return { data: {} };
        }),
        removeLabel: vi.fn(async (input: { issue_number: number; name: string }) => {
          actionState.removedLabels.push({
            issueNumber: input.issue_number,
            name: input.name,
          });

          return { data: {} };
        }),
      },
    },
  })),
}));

const originalCwd = process.cwd();
let temporaryDirectory = "";

afterEach(() => {
  process.chdir(originalCwd);
  actionState.outputs = [];
  actionState.existingComments = [];
  actionState.comments = [];
  actionState.updatedComments = [];
  actionState.labels = [];
  actionState.removedLabels = [];

  if (temporaryDirectory !== "") {
    rmSync(temporaryDirectory, { recursive: true, force: true });
    temporaryDirectory = "";
  }
});

describe("skippedForkResult", () => {
  it("fork PRではラベル更新なしのスキップ結果を返す", () => {
    const actual = skippedForkResult({
      rulesSource: { kind: "action-default", path: "rules/default.yml" },
    });

    expect(actual).toEqual({
      verdict: "SKIPPED_UNSUPPORTED_FORK",
      aiVerdict: null,
      summary: "fork からの PR はMVP対象外のため、自動判定をスキップしました。",
      deterministicMatches: [],
      aiTriggeredRules: [],
      rulesSource: { kind: "action-default", path: "rules/default.yml" },
      filesConsidered: [],
      labelUpdate: {
        shouldUpdate: false,
        addLabel: "",
        removeLabel: "",
      },
    });
  });
});

describe("runMain", () => {
  it("rules-onlyメタデータと新しいルールスキーマで決定的判定を結果JSONに書き出す", async () => {
    temporaryDirectory = mkdtempSync(join(tmpdir(), "self-merge-sentinel-main-"));
    process.chdir(temporaryDirectory);
    mkdirSync(".self-merge-sentinel");
    mkdirSync("rules");
    writeFileSync(
      ".self-merge-sentinel/metadata.json",
      JSON.stringify({
        prNumber: 12,
        unsupportedFork: false,
        rulesSource: { kind: "action-default", path: "rules/default.yml" },
      }),
    );
    writeFileSync(".self-merge-sentinel/changed-files.txt", "db/schema.sql\n");
    writeFileSync(
      ".self-merge-sentinel/ai-result.json",
      JSON.stringify({
        verdict: "SELF_MERGE_ALLOWED",
        summary: "AI上はセルフマージ可能です。",
        triggered_rules: [],
        files_considered: ["db/schema.sql"],
      }),
    );
    writeFileSync(
      "rules/default.yml",
      `version: 1
description: "迷う場合は人間レビュー必須です。"
default_verdict: "HUMAN_REVIEW_REQUIRED"
review_required_rules:
  - id: "database-change"
    description: "DB schema, migration, seed, destructive DDL"
    match:
      paths:
        - "db/**"
        - "**/schema.sql"
`,
    );

    await runMain();

    const actual = JSON.parse(
      readFileSync(".self-merge-sentinel/result.json", "utf8"),
    ) as unknown;

    expect({
      result: actual,
      outputs: actionState.outputs,
      comments: actionState.comments,
      labels: actionState.labels,
      removedLabels: actionState.removedLabels,
    }).toEqual({
      result: {
        verdict: "HUMAN_REVIEW_REQUIRED",
        aiVerdict: "SELF_MERGE_ALLOWED",
        summary: "決定的ルールに一致したため、人間レビューが必要です。",
        deterministicMatches: [
          {
            ruleId: "database-change",
            description: "DB schema, migration, seed, destructive DDL",
            pattern: "db/**",
            files: ["db/schema.sql"],
          },
          {
            ruleId: "database-change",
            description: "DB schema, migration, seed, destructive DDL",
            pattern: "**/schema.sql",
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
        commentUrl: "https://github.example/comment/1",
      },
      outputs: [
        { name: "verdict", value: "HUMAN_REVIEW_REQUIRED" },
        { name: "comment_url", value: "https://github.example/comment/1" },
        {
          name: "result_json",
          value: JSON.stringify(actual),
        },
      ],
      comments: [
        {
          issueNumber: 12,
          body: `<!-- self-merge-sentinel -->

## セルフマージ判定: 人間レビュー必須

決定的ルールに一致したため、人間レビューが必要です。

**判定:** \`HUMAN_REVIEW_REQUIRED\`

<details>
<summary>判定の詳細</summary>

### Rules設定

- source: \`action-default:rules/default.yml\`

### 決定的ルール

- rule_id: \`database-change\` / pattern: \`db/**\` / files: \`db/schema.sql\`
- rule_id: \`database-change\` / pattern: \`**/schema.sql\` / files: \`db/schema.sql\`

### AI判定

- \`SELF_MERGE_ALLOWED\`

### 考慮したファイル

- \`db/schema.sql\`

</details>
`,
        },
      ],
      labels: [{ issueNumber: 12, labels: ["review: human-required"] }],
      removedLabels: [{ issueNumber: 12, name: "self-merge: allowed" }],
    });
  });

  it("追加rulesのpath matchを決定的判定に使う", async () => {
    temporaryDirectory = mkdtempSync(join(tmpdir(), "self-merge-sentinel-main-"));
    process.chdir(temporaryDirectory);
    mkdirSync(".self-merge-sentinel");
    mkdirSync("rules");
    writeFileSync(
      ".self-merge-sentinel/metadata.json",
      JSON.stringify({
        prNumber: 56,
        unsupportedFork: false,
        rulesSource: { kind: "action-default", path: "rules/default.yml" },
        extraRulesSources: [{ kind: "repository", path: "rules/security.yml" }],
      }),
    );
    writeFileSync(".self-merge-sentinel/changed-files.txt", "security/policy.yml\n");
    writeFileSync(
      ".self-merge-sentinel/ai-result.json",
      JSON.stringify({
        verdict: "SELF_MERGE_ALLOWED",
        summary: "AI上はセルフマージ可能です。",
        triggered_rules: [],
        files_considered: ["security/policy.yml"],
      }),
    );
    writeFileSync(
      "rules/default.yml",
      `version: 1
description: "base"
default_verdict: "HUMAN_REVIEW_REQUIRED"
review_required_rules:
  - id: "database-change"
    description: "DB schema, migration, seed, destructive DDL"
    match:
      paths:
        - "db/**"
`,
    );
    writeFileSync(
      "rules/security.yml",
      `version: 1
description: "security"
default_verdict: "HUMAN_REVIEW_REQUIRED"
review_required_rules:
  - id: "security-policy-change"
    description: "Security policy changes"
    match:
      paths:
        - "security/**"
`,
    );

    await runMain();

    const actual = JSON.parse(
      readFileSync(".self-merge-sentinel/result.json", "utf8"),
    ) as Record<string, unknown>;

    expect({
      result: actual,
      labels: actionState.labels,
      removedLabels: actionState.removedLabels,
    }).toEqual({
      result: {
        verdict: "HUMAN_REVIEW_REQUIRED",
        aiVerdict: "SELF_MERGE_ALLOWED",
        summary: "決定的ルールに一致したため、人間レビューが必要です。",
        deterministicMatches: [
          {
            ruleId: "security-policy-change",
            description: "Security policy changes",
            pattern: "security/**",
            files: ["security/policy.yml"],
          },
        ],
        aiTriggeredRules: [],
        rulesSource: { kind: "action-default", path: "rules/default.yml" },
        filesConsidered: ["security/policy.yml"],
        labelUpdate: {
          shouldUpdate: true,
          addLabel: "review: human-required",
          removeLabel: "self-merge: allowed",
        },
        commentUrl: "https://github.example/comment/1",
      },
      labels: [{ issueNumber: 56, labels: ["review: human-required"] }],
      removedLabels: [{ issueNumber: 56, name: "self-merge: allowed" }],
    });
  });

  it("追加rulesでrule idが重複したらinvalid rules結果にする", async () => {
    temporaryDirectory = mkdtempSync(join(tmpdir(), "self-merge-sentinel-main-"));
    process.chdir(temporaryDirectory);
    mkdirSync(".self-merge-sentinel");
    mkdirSync("rules");
    writeFileSync(
      ".self-merge-sentinel/metadata.json",
      JSON.stringify({
        prNumber: 57,
        unsupportedFork: false,
        rulesSource: { kind: "repository", path: "rules/base.yml" },
        extraRulesSources: [{ kind: "repository", path: "rules/extra.yml" }],
      }),
    );
    writeFileSync(".self-merge-sentinel/changed-files.txt", "src/index.ts\n");
    writeFileSync(
      ".self-merge-sentinel/ai-result.json",
      JSON.stringify({
        verdict: "SELF_MERGE_ALLOWED",
        summary: "AI上はセルフマージ可能です。",
        triggered_rules: [],
        files_considered: ["src/index.ts"],
      }),
    );
    const duplicatedRule = `version: 1
description: "duplicated"
default_verdict: "HUMAN_REVIEW_REQUIRED"
review_required_rules:
  - id: "duplicated-rule"
    description: "Duplicated rule"
    match:
      semantic: true
`;
    writeFileSync("rules/base.yml", duplicatedRule);
    writeFileSync("rules/extra.yml", duplicatedRule);

    await runMain();

    const actual = JSON.parse(
      readFileSync(".self-merge-sentinel/result.json", "utf8"),
    ) as Record<string, unknown>;

    expect({
      result: actual,
      labels: actionState.labels,
      removedLabels: actionState.removedLabels,
    }).toEqual({
      result: {
        verdict: "AI_CLASSIFICATION_FAILED",
        aiVerdict: null,
        summary:
          "rules の読み込みに失敗したため、この自動判定だけではセルフマージ可否を判断できません。",
        deterministicMatches: [],
        aiTriggeredRules: [],
        rulesSource: { kind: "repository", path: "rules/base.yml" },
        filesConsidered: [],
        labelUpdate: {
          shouldUpdate: false,
          addLabel: "",
          removeLabel: "",
        },
        error: {
          code: "INVALID_RULE_CONFIG",
          message: "Duplicate self-merge rule id: duplicated-rule",
        },
        commentUrl: "https://github.example/comment/1",
      },
      labels: [],
      removedLabels: [],
    });
  });

  it("rules YAMLが不正でも判定失敗結果を書き出してコメント更新を継続する", async () => {
    temporaryDirectory = mkdtempSync(join(tmpdir(), "self-merge-sentinel-main-"));
    process.chdir(temporaryDirectory);
    mkdirSync(".self-merge-sentinel");
    mkdirSync("rules");
    writeFileSync(
      ".self-merge-sentinel/metadata.json",
      JSON.stringify({
        prNumber: 34,
        unsupportedFork: false,
        rulesSource: { kind: "repository", path: "rules/default.yml" },
      }),
    );
    writeFileSync(".self-merge-sentinel/changed-files.txt", "src/index.ts\n");
    writeFileSync(
      ".self-merge-sentinel/ai-result.json",
      JSON.stringify({
        verdict: "SELF_MERGE_ALLOWED",
        summary: "AI上はセルフマージ可能です。",
        triggered_rules: [],
        files_considered: ["src/index.ts"],
      }),
    );
    writeFileSync(
      "rules/default.yml",
      `version: 1
description: "broken"
default_verdict: "HUMAN_REVIEW_REQUIRED"
review_required_rules:
  - id: "missing-match"
    description: "match がないため不正"
`,
    );

    await runMain();

    const actual = JSON.parse(
      readFileSync(".self-merge-sentinel/result.json", "utf8"),
    ) as Record<string, unknown>;
    const legacySourceKey = "policy" + "Source";

    expect({
      result: actual,
      legacySourceValue: actual[legacySourceKey],
      outputs: actionState.outputs,
      comments: actionState.comments,
      labels: actionState.labels,
      removedLabels: actionState.removedLabels,
    }).toEqual({
      result: {
        verdict: "AI_CLASSIFICATION_FAILED",
        aiVerdict: null,
        summary:
          "rules の読み込みに失敗したため、この自動判定だけではセルフマージ可否を判断できません。",
        deterministicMatches: [],
        aiTriggeredRules: [],
        rulesSource: { kind: "repository", path: "rules/default.yml" },
        filesConsidered: [],
        labelUpdate: {
          shouldUpdate: false,
          addLabel: "",
          removeLabel: "",
        },
        error: {
          code: "INVALID_RULE_CONFIG",
          message: "Invalid self-merge rule config",
        },
        commentUrl: "https://github.example/comment/1",
      },
      legacySourceValue: undefined,
      outputs: [
        { name: "verdict", value: "AI_CLASSIFICATION_FAILED" },
        { name: "comment_url", value: "https://github.example/comment/1" },
        {
          name: "result_json",
          value: JSON.stringify(actual),
        },
      ],
      comments: [
        {
          issueNumber: 34,
          body: `<!-- self-merge-sentinel -->

## セルフマージ判定: 判定失敗

rules の読み込みに失敗したため、この自動判定だけではセルフマージ可否を判断できません。

**判定:** \`AI_CLASSIFICATION_FAILED\`

ラベルは更新していません。

<details>
<summary>判定の詳細</summary>

### Rules設定

- source: \`repository:rules/default.yml\`

### エラー

- \`INVALID_RULE_CONFIG\`: Invalid self-merge rule config

</details>
`,
        },
      ],
      labels: [],
      removedLabels: [],
    });
  });

  it("既存判定コメントがあるAI判定失敗では元の結果を残して詳細へ失敗を追記する", async () => {
    temporaryDirectory = mkdtempSync(join(tmpdir(), "self-merge-sentinel-main-"));
    process.chdir(temporaryDirectory);
    mkdirSync(".self-merge-sentinel");
    mkdirSync("rules");
    writeFileSync(
      ".self-merge-sentinel/metadata.json",
      JSON.stringify({
        prNumber: 78,
        unsupportedFork: false,
        rulesSource: { kind: "action-default", path: "rules/default.yml" },
      }),
    );
    writeFileSync(".self-merge-sentinel/changed-files.txt", "src/index.ts\n");
    writeFileSync(
      ".self-merge-sentinel/ai-result.json",
      JSON.stringify({ error: "missing structured_output" }),
    );
    writeFileSync(
      "rules/default.yml",
      `version: 1
description: "迷う場合は人間レビュー必須です。"
default_verdict: "HUMAN_REVIEW_REQUIRED"
review_required_rules:
  - id: "hard-to-rollback-change"
    description: "rollback が難しい変更"
    match:
      semantic: true
`,
    );
    actionState.existingComments = [
      {
        id: 401,
        body: `<!-- self-merge-sentinel -->

## セルフマージ判定: セルフマージ可

UI文言のみの変更です。

**判定:** \`SELF_MERGE_ALLOWED\`

<details>
<summary>判定の詳細</summary>

### Rules設定

- source: \`action-default:rules/default.yml\`

### AI判定

- \`SELF_MERGE_ALLOWED\`

</details>
`,
      },
    ];

    await runMain();

    const actual = JSON.parse(
      readFileSync(".self-merge-sentinel/result.json", "utf8"),
    ) as unknown;

    expect({
      result: actual,
      createdComments: actionState.comments,
      updatedComments: actionState.updatedComments,
      labels: actionState.labels,
      removedLabels: actionState.removedLabels,
    }).toEqual({
      result: {
        verdict: "AI_CLASSIFICATION_FAILED",
        aiVerdict: null,
        summary:
          "AI判定に失敗したため、この自動判定だけではセルフマージ可否を判断できません。",
        deterministicMatches: [],
        aiTriggeredRules: [],
        rulesSource: { kind: "action-default", path: "rules/default.yml" },
        filesConsidered: [],
        labelUpdate: {
          shouldUpdate: false,
          addLabel: "",
          removeLabel: "",
        },
        error: {
          code: "INVALID_AI_OUTPUT",
          message: "Claude structured output does not match the expected schema",
        },
        commentUrl: "https://github.example/comment/1",
      },
      createdComments: [],
      updatedComments: [
        {
          commentId: 401,
          body: `<!-- self-merge-sentinel -->

## セルフマージ判定: セルフマージ可

UI文言のみの変更です。

**判定:** \`SELF_MERGE_ALLOWED\`

<details>
<summary>判定の詳細</summary>

### Rules設定

- source: \`action-default:rules/default.yml\`

### AI判定

- \`SELF_MERGE_ALLOWED\`

### 後続実行の失敗

- \`INVALID_AI_OUTPUT\`: Claude structured output does not match the expected schema

</details>
`,
        },
      ],
      labels: [],
      removedLabels: [],
    });
  });

  it("既存判定コメントが判定失敗でもAI判定成功時は成功コメントへ置き換える", async () => {
    temporaryDirectory = mkdtempSync(join(tmpdir(), "self-merge-sentinel-main-"));
    process.chdir(temporaryDirectory);
    mkdirSync(".self-merge-sentinel");
    mkdirSync("rules");
    writeFileSync(
      ".self-merge-sentinel/metadata.json",
      JSON.stringify({
        prNumber: 79,
        unsupportedFork: false,
        rulesSource: { kind: "action-default", path: "rules/default.yml" },
      }),
    );
    writeFileSync(".self-merge-sentinel/changed-files.txt", "src/index.ts\n");
    writeFileSync(
      ".self-merge-sentinel/ai-result.json",
      JSON.stringify({
        verdict: "SELF_MERGE_ALLOWED",
        summary: "UI文言のみの変更です。",
        triggered_rules: [],
        files_considered: ["src/index.ts"],
      }),
    );
    writeFileSync(
      "rules/default.yml",
      `version: 1
description: "迷う場合は人間レビュー必須です。"
default_verdict: "HUMAN_REVIEW_REQUIRED"
review_required_rules:
  - id: "hard-to-rollback-change"
    description: "rollback が難しい変更"
    match:
      semantic: true
`,
    );
    actionState.existingComments = [
      {
        id: 402,
        body: `<!-- self-merge-sentinel -->

## セルフマージ判定: 判定失敗

AI判定に失敗したため、この自動判定だけではセルフマージ可否を判断できません。

**判定:** \`AI_CLASSIFICATION_FAILED\`

ラベルは更新していません。

<details>
<summary>判定の詳細</summary>

### Rules設定

- source: \`action-default:rules/default.yml\`

### エラー

- \`INVALID_AI_OUTPUT\`: Claude structured output does not match the expected schema

</details>
`,
      },
    ];

    await runMain();

    const actual = JSON.parse(
      readFileSync(".self-merge-sentinel/result.json", "utf8"),
    ) as unknown;

    expect({
      result: actual,
      createdComments: actionState.comments,
      updatedComments: actionState.updatedComments,
      labels: actionState.labels,
      removedLabels: actionState.removedLabels,
    }).toEqual({
      result: {
        verdict: "SELF_MERGE_ALLOWED",
        aiVerdict: "SELF_MERGE_ALLOWED",
        summary: "UI文言のみの変更です。",
        deterministicMatches: [],
        aiTriggeredRules: [],
        rulesSource: { kind: "action-default", path: "rules/default.yml" },
        filesConsidered: ["src/index.ts"],
        labelUpdate: {
          shouldUpdate: true,
          addLabel: "self-merge: allowed",
          removeLabel: "review: human-required",
        },
        commentUrl: "https://github.example/comment/1",
      },
      createdComments: [],
      updatedComments: [
        {
          commentId: 402,
          body: `<!-- self-merge-sentinel -->

## セルフマージ判定: セルフマージ可

UI文言のみの変更です。

**判定:** \`SELF_MERGE_ALLOWED\`

<details>
<summary>判定の詳細</summary>

### Rules設定

- source: \`action-default:rules/default.yml\`

### AI判定

- \`SELF_MERGE_ALLOWED\`

### 考慮したファイル

- \`src/index.ts\`

</details>
`,
        },
      ],
      labels: [{ issueNumber: 79, labels: ["self-merge: allowed"] }],
      removedLabels: [{ issueNumber: 79, name: "review: human-required" }],
    });
  });
});

describe("parseChangedFiles", () => {
  const cases = [
    {
      name: "空行を除外してファイル一覧を返す",
      content: "src/a.ts\n\nsrc/b.ts\n",
      expected: ["src/a.ts", "src/b.ts"],
    },
    {
      name: "パス名の先頭末尾スペースとタブは保持する",
      content: " leading/file.ts \r\n\tTabbed.ts\n",
      expected: [" leading/file.ts ", "\tTabbed.ts"],
    },
  ];

  it.each(cases)("$name", ({ content, expected }) => {
    const actual = parseChangedFiles(content);

    expect(actual).toEqual(expected);
  });
});

describe("tryUpsertComment", () => {
  it("コメント更新に成功したらURLを返し警告しない", async () => {
    const warnings: string[] = [];

    const actual = await tryUpsertComment({
      upsert: async () => "https://github.example/comment/1",
      warn: (message) => {
        warnings.push(message);
      },
    });

    expect({ actual, warnings }).toEqual({
      actual: "https://github.example/comment/1",
      warnings: [],
    });
  });

  it("コメント更新に失敗しても空URLを返して処理を継続できる", async () => {
    const warnings: string[] = [];

    const actual = await tryUpsertComment({
      upsert: async () => {
        throw new Error("Resource not accessible by integration");
      },
      warn: (message) => {
        warnings.push(message);
      },
    });

    expect({ actual, warnings }).toEqual({
      actual: "",
      warnings: [
        "Self-merge sentinel comment update failed: Resource not accessible by integration",
      ],
    });
  });
});
