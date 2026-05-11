import { defineConfig } from "tsup";

export default defineConfig({
  entry: ["src/prepare.ts", "src/main.ts"],
  format: ["cjs"],
  target: "node20",
  platform: "node",
  outDir: "dist",
  clean: true,
  outExtension: () => ({ js: ".cjs" }),
  noExternal: ["@actions/core", "@actions/github", "js-yaml", "picomatch"],
});
