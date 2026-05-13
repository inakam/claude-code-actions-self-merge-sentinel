import * as github from "@actions/github";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  isUnsupportedForkPullRequest,
  parseExtraRulesPaths,
  resolvePullRequestContext,
  resolveUnsupportedForkPullRequest,
  resolvePrNumber,
  resolveSource,
  runPrepare,
} from "../src/prepare.js";

function parseGithubOutput(content: string): Record<string, string> {
  return Object.fromEntries(
    [...content.matchAll(/^([^<\n]+)<<(.+)\n([\s\S]*?)\n\2$/gm)].map(
      ([, name, , value]) => [name, value],
    ),
  );
}

describe("resolvePrNumber", () => {
  const cases = [
    {
      name: "明示inputを優先する",
      explicit: "42",
      eventPullRequestNumber: 7,
      expected: 42,
    },
    {
      name: "inputが空ならpull_request payloadを使う",
      explicit: "",
      eventPullRequestNumber: 7,
      expected: 7,
    },
  ];

  it.each(cases)("$name", ({ explicit, eventPullRequestNumber, expected }) => {
    const actual = resolvePrNumber({ explicit, eventPullRequestNumber });

    expect(actual).toEqual(expected);
  });

  it("PR番号がどちらにも無ければエラーにする", () => {
    expect(() =>
      resolvePrNumber({ explicit: "", eventPullRequestNumber: undefined }),
    ).toThrow("PR number is required for self-merge sentinel");
  });

  const invalidCases = [
    {
      name: "明示inputが0ならエラーにする",
      explicit: "0",
      eventPullRequestNumber: 7,
    },
    {
      name: "明示inputが負数ならエラーにする",
      explicit: "-1",
      eventPullRequestNumber: 7,
    },
    {
      name: "明示inputが小数ならエラーにする",
      explicit: "1.5",
      eventPullRequestNumber: 7,
    },
    {
      name: "payloadのPR番号が0ならエラーにする",
      explicit: "",
      eventPullRequestNumber: 0,
    },
  ];

  it.each(invalidCases)("$name", ({ explicit, eventPullRequestNumber }) => {
    expect(() => resolvePrNumber({ explicit, eventPullRequestNumber })).toThrow(
      "PR number is required for self-merge sentinel",
    );
  });
});

describe("resolvePullRequestContext", () => {
  const cases = [
    {
      name: "明示inputを優先する",
      explicit: "42",
      eventPullRequestNumber: 7,
      eventIssueNumber: 8,
      eventIssueIsPullRequest: true,
      expected: {
        isPullRequest: true,
        prNumber: 42,
      },
    },
    {
      name: "pull_request payloadを使う",
      explicit: "",
      eventPullRequestNumber: 7,
      eventIssueNumber: undefined,
      eventIssueIsPullRequest: false,
      expected: {
        isPullRequest: true,
        prNumber: 7,
      },
    },
    {
      name: "PRへのissue_commentならissue番号をPR番号として使う",
      explicit: "",
      eventPullRequestNumber: undefined,
      eventIssueNumber: 8,
      eventIssueIsPullRequest: true,
      expected: {
        isPullRequest: true,
        prNumber: 8,
      },
    },
    {
      name: "通常issueならPR文脈ではない",
      explicit: "",
      eventPullRequestNumber: undefined,
      eventIssueNumber: 8,
      eventIssueIsPullRequest: false,
      expected: {
        isPullRequest: false,
        prNumber: null,
      },
    },
  ];

  it.each(cases)("$name", (testCase) => {
    const actual = resolvePullRequestContext(testCase);

    expect(actual).toEqual(testCase.expected);
  });
});

describe("resolveSource", () => {
  const cases = [
    {
      name: "導入先パスが指定されていればrepository sourceにする",
      repositoryPath: ".github/self-merge-rules.yml",
      defaultPath: "rules/default.yml",
      expected: {
        kind: "repository",
        path: ".github/self-merge-rules.yml",
      },
    },
    {
      name: "導入先パスが空ならaction default sourceにする",
      repositoryPath: "",
      defaultPath: "rules/default.yml",
      expected: {
        kind: "action-default",
        path: "rules/default.yml",
      },
    },
  ] as const;

  it.each(cases)("$name", ({ repositoryPath, defaultPath, expected }) => {
    const actual = resolveSource({ repositoryPath, defaultPath });

    expect(actual).toEqual(expected);
  });
});

describe("parseExtraRulesPaths", () => {
  const cases = [
    {
      name: "空文字なら空配列を返す",
      content: "",
      expected: [],
    },
    {
      name: "改行区切りのパスをtrimして返す",
      content: " .github/a.yml \n.github/b.yml\n",
      expected: [".github/a.yml", ".github/b.yml"],
    },
    {
      name: "空行だけを無視する",
      content: "\n.github/a.yml\n\n  \n.github/b.yml\n",
      expected: [".github/a.yml", ".github/b.yml"],
    },
  ];

  it.each(cases)("$name", ({ content, expected }) => {
    const actual = parseExtraRulesPaths(content);

    expect(actual).toEqual(expected);
  });
});

describe("isUnsupportedForkPullRequest", () => {
  afterEach(() => {
    github.context.payload = {};
  });

  const cases = [
    {
      name: "pull_request payloadが無ければfalseを返す",
      payload: {},
      expected: false,
    },
    {
      name: "headとbaseのrepoが同じならfalseを返す",
      payload: {
        pull_request: {
          number: 1,
          head: { repo: { full_name: "owner/repo" } },
          base: { repo: { full_name: "owner/repo" } },
        },
      },
      expected: false,
    },
    {
      name: "headとbaseのrepoが違えばtrueを返す",
      payload: {
        pull_request: {
          number: 1,
          head: { repo: { full_name: "fork/repo" } },
          base: { repo: { full_name: "owner/repo" } },
        },
      },
      expected: true,
    },
    {
      name: "head repoが無ければtrueを返す",
      payload: {
        pull_request: {
          number: 1,
          head: { repo: null },
          base: { repo: { full_name: "owner/repo" } },
        },
      },
      expected: true,
    },
  ];

  it.each(cases)("$name", ({ payload, expected }) => {
    github.context.payload = payload;

    const actual = isUnsupportedForkPullRequest();

    expect(actual).toEqual(expected);
  });
});

describe("resolveUnsupportedForkPullRequest", () => {
  afterEach(() => {
    github.context.payload = {};
  });

  it("pull_request payloadが無い手動実行ではPR APIのhead/base repoでfork判定する", async () => {
    github.context.payload = {};

    const actual = await resolveUnsupportedForkPullRequest({
      prNumber: 12,
      token: "github-token",
      fetchRepositoryNames: async () => ({
        headRepositoryFullName: "fork/repo",
        baseRepositoryFullName: "owner/repo",
      }),
    });

    expect(actual).toEqual(true);
  });

  it("pull_request payloadが無い手動実行でhead/base repoが同じならfork扱いしない", async () => {
    github.context.payload = {};

    const actual = await resolveUnsupportedForkPullRequest({
      prNumber: 12,
      token: "github-token",
      fetchRepositoryNames: async () => ({
        headRepositoryFullName: "owner/repo",
        baseRepositoryFullName: "owner/repo",
      }),
    });

    expect(actual).toEqual(false);
  });
});

describe("runPrepare", () => {
  const originalCwd = process.cwd();
  const originalEnv = { ...process.env };

  afterEach(() => {
    process.chdir(originalCwd);
    process.env = { ...originalEnv };
    github.context.payload = {};
  });

  it("PR文脈とsourceをmetadataとoutputsに出力する", async () => {
    const workspace = mkdtempSync(join(tmpdir(), "prepare-test-"));
    const githubOutput = join(workspace, "github-output");
    const actionPath = join(workspace, "action");
    writeFileSync(githubOutput, "");
    mkdirSync(join(workspace, ".github"), { recursive: true });
    mkdirSync(actionPath, { recursive: true });
    writeFileSync(
      join(workspace, ".github/self-merge-rules.yml"),
      `
version: 1
description: |
  base rules
default_verdict: "HUMAN_REVIEW_REQUIRED"
review_required_rules:
  - id: "database-change"
    description: "DB schema, migration, seed, destructive DDL"
    match:
      paths:
        - "db/**"
  - id: "auth-or-authorization-change"
    description: "Authentication, authorization, session, permission, or tenant isolation behavior"
    match:
      semantic: true
`,
    );
    writeFileSync(
      join(workspace, ".github/self-merge-rules.database.yml"),
      `
version: 1
description: |
  database team rules
default_verdict: "HUMAN_REVIEW_REQUIRED"
review_required_rules:
  - id: "hard-to-rollback-change"
    description: "Any change where rollback is hard, incomplete, or risky"
    match:
      semantic: true
`,
    );
    writeFileSync(
      join(workspace, ".github/self-merge-rules.security.yml"),
      `
version: 1
description: |
  security team rules
default_verdict: "HUMAN_REVIEW_REQUIRED"
review_required_rules:
  - id: "security-path-only"
    description: "Security-owned path"
    match:
      paths:
        - "security/**"
`,
    );
    process.chdir(workspace);
    process.env = {
      ...originalEnv,
      GITHUB_ACTION_PATH: actionPath,
      GITHUB_OUTPUT: githubOutput,
      INPUT_PR_NUMBER: "",
      INPUT_RULES_PATH: ".github/self-merge-rules.yml",
      INPUT_EXTRA_RULES_PATHS:
        " .github/self-merge-rules.database.yml \n\n.github/self-merge-rules.security.yml\n",
      INPUT_GITHUB_TOKEN: "github-token",
    };
    github.context.payload = {
      pull_request: {
        number: 12,
        head: { repo: { full_name: "fork/repo" } },
        base: { repo: { full_name: "owner/repo" } },
      },
    };

    await runPrepare();

    const actual = {
      metadata: JSON.parse(
        readFileSync(".self-merge-sentinel/metadata.json", "utf8"),
      ),
      outputs: parseGithubOutput(readFileSync(githubOutput, "utf8")),
    };

    expect(actual).toEqual({
      metadata: {
        prNumber: 12,
        unsupportedFork: true,
        rulesSource: {
          kind: "repository",
          path: ".github/self-merge-rules.yml",
        },
        extraRulesSources: [
          {
            kind: "repository",
            path: ".github/self-merge-rules.database.yml",
          },
          {
            kind: "repository",
            path: ".github/self-merge-rules.security.yml",
          },
        ],
      },
      outputs: {
        is_pull_request: "true",
        pr_number: "12",
        unsupported_fork: "true",
        rules_path: ".github/self-merge-rules.yml",
        semantic_rules_prompt:
          "Self-merge rules description:\n" +
          "base rules\n" +
          "\n" +
          "database team rules\n" +
          "\n" +
          "security team rules\n" +
          "\n" +
          "Semantic review-required rules:\n" +
          "- auth-or-authorization-change: Authentication, authorization, session, permission, or tenant isolation behavior\n" +
          "- hard-to-rollback-change: Any change where rollback is hard, incomplete, or risky\n",
      },
    });

    rmSync(workspace, { recursive: true, force: true });
  });

  it("通常issueではPR判定をスキップするoutputsを出力する", async () => {
    const workspace = mkdtempSync(join(tmpdir(), "prepare-test-"));
    const githubOutput = join(workspace, "github-output");
    writeFileSync(githubOutput, "");

    try {
      process.chdir(workspace);
      process.env = {
        ...originalEnv,
        GITHUB_OUTPUT: githubOutput,
        INPUT_PR_NUMBER: "",
        INPUT_RULES_PATH: "",
        INPUT_EXTRA_RULES_PATHS: "",
        INPUT_GITHUB_TOKEN: "github-token",
      };
      github.context.payload = {
        issue: {
          number: 12,
        },
      };

      await runPrepare();

      const actual = {
        outputs: parseGithubOutput(readFileSync(githubOutput, "utf8")),
      };

      expect(actual).toEqual({
        outputs: {
          is_pull_request: "false",
          pr_number: "",
          unsupported_fork: "false",
        },
      });
    } finally {
      rmSync(workspace, { recursive: true, force: true });
    }
  });

  it("rulesが壊れている場合はprepareを失敗させる", async () => {
    const workspace = mkdtempSync(join(tmpdir(), "prepare-test-"));
    const githubOutput = join(workspace, "github-output");
    const actionPath = join(workspace, "action");
    writeFileSync(githubOutput, "");
    mkdirSync(join(workspace, ".github"), { recursive: true });
    writeFileSync(
      join(workspace, ".github/self-merge-rules.yml"),
      `
version: 1
description: "invalid"
default_verdict: "HUMAN_REVIEW_REQUIRED"
review_required_rules:
  - id: ""
    description: "empty id"
    match:
      semantic: true
`,
    );
    try {
      process.chdir(workspace);
      process.env = {
        ...originalEnv,
        GITHUB_ACTION_PATH: actionPath,
        GITHUB_OUTPUT: githubOutput,
        INPUT_PR_NUMBER: "12",
        INPUT_RULES_PATH: ".github/self-merge-rules.yml",
        INPUT_EXTRA_RULES_PATHS: "",
        INPUT_GITHUB_TOKEN: "github-token",
      };
      github.context.payload = {
        pull_request: {
          number: 12,
          head: { repo: { full_name: "owner/repo" } },
          base: { repo: { full_name: "owner/repo" } },
        },
      };

      await expect(runPrepare()).rejects.toThrow(
        "Invalid self-merge rule config",
      );
    } finally {
      rmSync(workspace, { recursive: true, force: true });
    }
  });
});
