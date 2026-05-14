import { readFileSync } from "node:fs";
import { load } from "js-yaml";
import { describe, expect, it } from "vitest";

describe("リリース設定", () => {
  const cases = [
    {
      name: "tagpr でリリース PR と v1 rolling tag を管理する",
      expected: {
        tagprConfig: {
          releaseBranch: "main",
          versionFile: "package.json,package-lock.json",
          vPrefix: true,
          changelog: true,
        },
        packageVersions: {
          packageJson: "1.0.0",
          packageLockRoot: "1.0.0",
          packageLockPackage: "1.0.0",
        },
        workflow: {
          name: "tagpr",
          pushBranches: ["main"],
          permissions: {
            contents: "write",
            pullRequests: "write",
            issues: "read",
          },
          checkout: {
            uses: "actions/checkout@v6",
            persistCredentials: false,
            fetchDepth: 0,
          },
          tagpr: {
            uses: "Songmu/tagpr@v1",
            tokenEnv: "${{ secrets.GITHUB_TOKEN }}",
          },
          updateMajorTag: {
            uses: "haya14busa/action-update-semver@v1",
            condition: "steps.tagpr.outputs.tag != ''",
            tag: "${{ steps.tagpr.outputs.tag }}",
            majorVersionTagOnly: true,
          },
        },
      },
    },
  ];

  it.each(cases)("$name", ({ expected }) => {
    const tagprConfig = readTagprConfig(readFileSync(".tagpr", "utf8"));
    const packageJson = JSON.parse(readFileSync("package.json", "utf8")) as {
      version: string;
    };
    const packageLockJson = JSON.parse(readFileSync("package-lock.json", "utf8")) as {
      version: string;
      packages: {
        "": {
          version: string;
        };
      };
    };
    const workflow = load(readFileSync(".github/workflows/tagpr.yml", "utf8")) as TagprWorkflow;

    const actual = {
      tagprConfig,
      packageVersions: {
        packageJson: packageJson.version,
        packageLockRoot: packageLockJson.version,
        packageLockPackage: packageLockJson.packages[""].version,
      },
      workflow: {
        name: workflow.name,
        pushBranches: workflow.on.push.branches,
        permissions: {
          contents: workflow.permissions.contents,
          pullRequests: workflow.permissions["pull-requests"],
          issues: workflow.permissions.issues,
        },
        checkout: {
          uses: workflow.jobs.tagpr.steps[0]?.uses,
          persistCredentials: workflow.jobs.tagpr.steps[0]?.with?.["persist-credentials"],
          fetchDepth: workflow.jobs.tagpr.steps[0]?.with?.["fetch-depth"],
        },
        tagpr: {
          uses: workflow.jobs.tagpr.steps[1]?.uses,
          tokenEnv: workflow.jobs.tagpr.steps[1]?.env?.GITHUB_TOKEN,
        },
        updateMajorTag: {
          uses: workflow.jobs.tagpr.steps[2]?.uses,
          condition: workflow.jobs.tagpr.steps[2]?.if,
          tag: workflow.jobs.tagpr.steps[2]?.with?.tag,
          majorVersionTagOnly: workflow.jobs.tagpr.steps[2]?.with?.major_version_tag_only,
        },
      },
    };

    expect(actual).toEqual(expected);
  });
});

function readTagprConfig(content: string): TagprConfig {
  const values = Object.fromEntries(
    Array.from(content.matchAll(/^\s+([A-Za-z]+)\s*=\s*(.+)$/gm), (match) => [
      match[1],
      match[2],
    ]),
  );

  return {
    releaseBranch: values.releaseBranch,
    versionFile: values.versionFile,
    vPrefix: values.vPrefix === "true",
    changelog: values.changelog === "true",
  };
}

type TagprConfig = {
  releaseBranch: string | undefined;
  versionFile: string | undefined;
  vPrefix: boolean;
  changelog: boolean;
};

type TagprWorkflow = {
  name: string;
  on: {
    push: {
      branches: string[];
    };
  };
  permissions: {
    contents: string;
    "pull-requests": string;
    issues: string;
  };
  jobs: {
    tagpr: {
      steps: Array<{
        uses?: string;
        if?: string;
        env?: {
          GITHUB_TOKEN?: string;
        };
        with?: {
          "persist-credentials"?: boolean;
          "fetch-depth"?: number;
          tag?: string;
          major_version_tag_only?: boolean;
        };
      }>;
    };
  };
};
