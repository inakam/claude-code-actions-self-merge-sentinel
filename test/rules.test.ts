import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  findDeterministicMatches,
  mergeRuleConfigs,
  parseRuleConfig,
} from "../src/rules.js";

const validRulesYaml = `
version: 1
description: |
  セルフマージ可否は、その変更が容易にやり直せるかで判断する。
default_verdict: "HUMAN_REVIEW_REQUIRED"
review_required_rules:
  - id: "database-change"
    description: "DB schema, migration, seed, destructive DDL"
    match:
      paths:
        - "db/**"
        - "**/schema.sql"
  - id: "foundational-library-change"
    description: "Adds, replaces, or removes a foundational library or framework"
    match:
      semantic: true
`;

describe("parseRuleConfig", () => {
  it("rules-only YAMLを正規化して読み込む", () => {
    const actual = parseRuleConfig(validRulesYaml);

    expect(actual).toEqual({
      version: 1,
      description:
        "セルフマージ可否は、その変更が容易にやり直せるかで判断する。\n",
      defaultVerdict: "HUMAN_REVIEW_REQUIRED",
      reviewRequiredRules: [
        {
          id: "database-change",
          description: "DB schema, migration, seed, destructive DDL",
          match: {
            paths: ["db/**", "**/schema.sql"],
          },
        },
        {
          id: "foundational-library-change",
          description: "Adds, replaces, or removes a foundational library or framework",
          match: {
            semantic: true,
          },
        },
      ],
    });
  });

  const invalidCases = [
    {
      name: "YAML構文が壊れている",
      content: `
version: 1
description: "unterminated
default_verdict: "HUMAN_REVIEW_REQUIRED"
review_required_rules: []
`,
    },
    {
      name: "YAMLがオブジェクトでない",
      content: "- invalid",
    },
    {
      name: "version が 1 ではない",
      content: `
version: 2
description: "invalid"
default_verdict: "HUMAN_REVIEW_REQUIRED"
review_required_rules: []
`,
    },
    {
      name: "default_verdict が HUMAN_REVIEW_REQUIRED ではない",
      content: `
version: 1
description: "invalid"
default_verdict: "SELF_MERGE_ALLOWED"
review_required_rules: []
`,
    },
    {
      name: "旧 schema の root key が混在している",
      content: `
version: 1
description: "invalid"
default_verdict: "HUMAN_REVIEW_REQUIRED"
review_required_rules: []
human_review_required_paths: {}
semantic_human_review_required: []
default_when_uncertain: "HUMAN_REVIEW_REQUIRED"
`,
    },
    {
      name: "rule に未知の key がある",
      content: `
version: 1
description: "invalid"
default_verdict: "HUMAN_REVIEW_REQUIRED"
review_required_rules:
  - id: "unknown-rule-key"
    description: "unknown rule key"
    severity: "high"
    match:
      semantic: true
`,
    },
    {
      name: "match に未知の key がある",
      content: `
version: 1
description: "invalid"
default_verdict: "HUMAN_REVIEW_REQUIRED"
review_required_rules:
  - id: "unknown-match-key"
    description: "unknown match key"
    match:
      semantic: true
      extensions:
        - ".sql"
`,
    },
    {
      name: "rule id が重複している",
      content: `
version: 1
description: "invalid"
default_verdict: "HUMAN_REVIEW_REQUIRED"
review_required_rules:
  - id: "duplicate"
    description: "first"
    match:
      semantic: true
  - id: "duplicate"
    description: "second"
    match:
      paths:
        - "src/**"
`,
    },
    {
      name: "rule id が空",
      content: `
version: 1
description: "invalid"
default_verdict: "HUMAN_REVIEW_REQUIRED"
review_required_rules:
  - id: ""
    description: "empty id"
    match:
      semantic: true
`,
    },
    {
      name: "match が paths も semantic も持たない",
      content: `
version: 1
description: "invalid"
default_verdict: "HUMAN_REVIEW_REQUIRED"
review_required_rules:
  - id: "empty-match"
    description: "empty match"
    match: {}
`,
    },
  ];

  it.each(invalidCases)("$name 場合はエラーにする", ({ content }) => {
    expect(() => parseRuleConfig(content)).toThrow(
      "Invalid self-merge rule config",
    );
  });
});

describe("mergeRuleConfigs", () => {
  it("複数rulesを順序どおりに連結する", () => {
    const base = parseRuleConfig(`
version: 1
description: |
  base description
default_verdict: "HUMAN_REVIEW_REQUIRED"
review_required_rules:
  - id: "base-rule"
    description: "Base rule"
    match:
      paths:
        - "base/**"
`);
    const extra = parseRuleConfig(`
version: 1
description: |
  extra description
default_verdict: "HUMAN_REVIEW_REQUIRED"
review_required_rules:
  - id: "extra-rule"
    description: "Extra rule"
    match:
      semantic: true
`);

    const actual = mergeRuleConfigs([base, extra]);

    expect(actual).toEqual({
      version: 1,
      description: "base description\n\nextra description\n",
      defaultVerdict: "HUMAN_REVIEW_REQUIRED",
      reviewRequiredRules: [
        {
          id: "base-rule",
          description: "Base rule",
          match: {
            paths: ["base/**"],
          },
        },
        {
          id: "extra-rule",
          description: "Extra rule",
          match: {
            semantic: true,
          },
        },
      ],
    });
  });

  it("rule idが重複したらエラーにする", () => {
    const base = parseRuleConfig(`
version: 1
description: "base"
default_verdict: "HUMAN_REVIEW_REQUIRED"
review_required_rules:
  - id: "duplicate-rule"
    description: "Base rule"
    match:
      paths:
        - "base/**"
`);
    const extra = parseRuleConfig(`
version: 1
description: "extra"
default_verdict: "HUMAN_REVIEW_REQUIRED"
review_required_rules:
  - id: "duplicate-rule"
    description: "Extra rule"
    match:
      semantic: true
`);

    expect(() => mergeRuleConfigs([base, extra])).toThrow(
      "Duplicate self-merge rule id: duplicate-rule",
    );
  });
});

describe("findDeterministicMatches", () => {
  const rules = parseRuleConfig(validRulesYaml);

  const cases = [
    {
      name: "db配下のファイルは database-change の db/** に一致する",
      files: ["db/schema.sql"],
      expected: [
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
    },
    {
      name: "任意ディレクトリのschema.sqlは database-change の **/schema.sql に一致する",
      files: ["service/schema.sql"],
      expected: [
        {
          ruleId: "database-change",
          description: "DB schema, migration, seed, destructive DDL",
          pattern: "**/schema.sql",
          files: ["service/schema.sql"],
        },
      ],
    },
    {
      name: "prisma migrations はデフォルトの database-change に一致しない",
      files: ["prisma/migrations/001.sql"],
      expected: [],
    },
    {
      name: "UIファイルだけなら一致しない",
      files: ["src/components/Button.tsx"],
      expected: [],
    },
  ];

  it.each(cases)("$name", ({ files, expected }) => {
    const actual = findDeterministicMatches(rules, files);

    expect(actual).toEqual(expected);
  });

  it("dotfile も決定的ルールの対象にする", () => {
    const dotfileRules = parseRuleConfig(`
version: 1
description: "dotfile rule"
default_verdict: "HUMAN_REVIEW_REQUIRED"
review_required_rules:
  - id: "environment-change"
    description: "Environment file changes"
    match:
      paths:
        - "**/.env"
`);

    const actual = findDeterministicMatches(dotfileRules, ["app/.env"]);

    expect(actual).toEqual([
      {
        ruleId: "environment-change",
        description: "Environment file changes",
        pattern: "**/.env",
        files: ["app/.env"],
      },
    ]);
  });
});

describe("rules/default.yml", () => {
  it("同梱デフォルトrulesを読み込める", () => {
    const actual = parseRuleConfig(readFileSync("rules/default.yml", "utf8"));

    expect(actual).toEqual({
      version: 1,
      description:
        "セルフマージ可否は、その変更が容易にやり直せるかで判断する。\n判断に迷う場合は人間レビュー必須とする。\nAIの判定は最終承認ではなく、PR作成者とチームの判断材料である。\n",
      defaultVerdict: "HUMAN_REVIEW_REQUIRED",
      reviewRequiredRules: [
        {
          id: "database-change",
          description: "DB schema, migration, seed, destructive DDL",
          match: {
            paths: ["db/**", "**/schema.sql"],
          },
        },
        {
          id: "auth-or-authorization-change",
          description:
            "Authentication, authorization, session, permission, or tenant isolation behavior",
          match: {
            paths: [
              "src/**/auth/**",
              "app/api/auth/**",
              "middleware.ts",
              "src/middleware.ts",
              "supabase/policies/**",
              "**/rls/**",
            ],
            semantic: true,
          },
        },
        {
          id: "infrastructure-or-release-change",
          description:
            "Deployment, release, infrastructure, or production runtime behavior",
          match: {
            paths: [
              "infra/**",
              "terraform/**",
              "pulumi/**",
              "cdk/**",
              ".github/workflows/deploy*.yml",
              ".github/workflows/release*.yml",
              "vercel.json",
              "fly.toml",
              "render.yaml",
            ],
            semantic: true,
          },
        },
        {
          id: "foundational-library-change",
          description: "Adds, replaces, or removes a foundational library or framework",
          match: {
            semantic: true,
          },
        },
        {
          id: "public-api-contract-change",
          description:
            "Changes public API contracts in a way that may affect external clients",
          match: {
            semantic: true,
          },
        },
        {
          id: "hard-to-rollback-change",
          description: "Any change where rollback is hard, incomplete, or risky",
          match: {
            semantic: true,
          },
        },
      ],
    });
  });
});
