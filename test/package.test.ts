import { readFileSync } from "node:fs";
import { builtinModules } from "node:module";
import { describe, expect, it } from "vitest";

describe("配布用ビルド設定", () => {
  const cases = [
    {
      name: "composite action の dist は依存込みで bundle する",
      expected: {
        usesBuildConfig: true,
        hasNoExternalConfig: true,
        actionEntrypoints: ["dist/prepare.cjs", "dist/main.cjs"],
        externalImportsInDist: [],
        externalRequiresInDist: [],
      },
    },
  ];

  it.each(cases)("$name", ({ expected }) => {
    const packageJson = JSON.parse(readFileSync("package.json", "utf8")) as {
      scripts: Record<string, string>;
    };
    const buildScript = packageJson.scripts.build ?? "";
    const buildConfig = readFileSync("tsup.config.ts", "utf8");
    const actionYml = readFileSync("action.yml", "utf8");
    const distFiles = ["dist/prepare.cjs", "dist/main.cjs"];

    const actual = {
      usesBuildConfig: buildScript.includes("--config tsup.config.ts"),
      hasNoExternalConfig:
        buildConfig.includes("noExternal") &&
        ["@actions/core", "@actions/github", "js-yaml", "picomatch"].every((dependency) =>
          buildConfig.includes(dependency),
        ),
      actionEntrypoints: Array.from(
        actionYml.matchAll(/node "\$\{\{ github\.action_path \}\}\/([^"]+)"/g),
        (match) => match[1],
      ),
      externalImportsInDist: distFiles.flatMap((path) =>
        externalImports(readFileSync(path, "utf8")).map((importPath) => ({
          path,
          importPath,
        })),
      ),
      externalRequiresInDist: distFiles.flatMap((path) =>
        externalRequires(readFileSync(path, "utf8")).map((requirePath) => ({
          path,
          requirePath,
        })),
      ),
    };

    expect(actual).toEqual(expected);
  });
});

function externalImports(content: string): string[] {
  const builtins = new Set(builtinModules);

  return Array.from(content.matchAll(/^import\s+.*?from\s+["']([^."'][^"']*)["'];$/gm))
    .map((match) => match[1])
    .filter((importPath): importPath is string => importPath !== undefined)
    .filter((importPath) => !builtins.has(importPath));
}

function externalRequires(content: string): string[] {
  const builtins = new Set(builtinModules);

  return Array.from(content.matchAll(/require\(["']([^."'][^"']*)["']\)/g))
    .map((match) => match[1])
    .filter((requirePath): requirePath is string => requirePath !== undefined)
    .filter((requirePath) => !builtins.has(requirePath));
}
