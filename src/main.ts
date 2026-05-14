import * as core from "@actions/core";
import * as github from "@actions/github";
import { readFileSync, writeFileSync } from "node:fs";
import { appendSubsequentFailureDetails, renderComment } from "./comment.js";
import { applyLabels, upsertComment } from "./github.js";
import { labelUpdateForVerdict } from "./labels.js";
import { finalizeResult, invalidRuleConfigResult } from "./result.js";
import {
  findDeterministicMatches,
  mergeRuleConfigs,
  parseRuleConfig,
} from "./rules.js";
import type { FinalResult, RuleConfig, Source } from "./types.js";

type Labels = {
  allowed: string;
  humanRequired: string;
};

type Metadata = {
  prNumber: number;
  unsupportedFork: boolean;
  rulesSource: Source;
  extraRulesSources?: Source[];
};

const defaultLabels: Labels = {
  allowed: "self-merge: allowed",
  humanRequired: "review: human-required",
};

export function skippedForkResult(input: {
  rulesSource: Source;
}): FinalResult {
  return {
    verdict: "SKIPPED_UNSUPPORTED_FORK",
    aiVerdict: null,
    summary: "fork からの PR はMVP対象外のため、自動判定をスキップしました。",
    deterministicMatches: [],
    aiTriggeredRules: [],
    rulesSource: input.rulesSource,
    filesConsidered: [],
    labelUpdate: labelUpdateForVerdict("SKIPPED_UNSUPPORTED_FORK", defaultLabels),
  };
}

export async function runMain(): Promise<void> {
  const metadata = readJson<Metadata>(".self-merge-sentinel/metadata.json");
  const token = core.getInput("github_token", { required: true });
  const marker = core.getInput("comment_marker") || "<!-- self-merge-sentinel -->";
  const labels = {
    allowed: core.getInput("allowed_label") || defaultLabels.allowed,
    humanRequired: core.getInput("human_required_label") || defaultLabels.humanRequired,
  };

  const result = metadata.unsupportedFork
    ? skippedForkResult(metadata)
    : buildFinalResult({ metadata, labels });
  const commentBody = renderComment(result, marker);
  const bodyForExistingComment =
    result.verdict === "AI_CLASSIFICATION_FAILED"
      ? (existingBody: string) => appendSubsequentFailureDetails(existingBody, result)
      : undefined;
  const commentUrl = await tryUpsertComment({
    upsert: () =>
      upsertComment({
        token,
        owner: github.context.repo.owner,
        repo: github.context.repo.repo,
        issueNumber: metadata.prNumber,
        marker,
        body: commentBody,
        ...(bodyForExistingComment ? { bodyForExistingComment } : {}),
      }),
    warn: (message) => {
      core.warning(message);
    },
  });
  const resultWithComment = {
    ...result,
    commentUrl,
  };

  if (resultWithComment.labelUpdate.shouldUpdate) {
    await applyLabels({
      token,
      owner: github.context.repo.owner,
      repo: github.context.repo.repo,
      issueNumber: metadata.prNumber,
      plan: resultWithComment.labelUpdate,
    });
  }

  writeFileSync(
    ".self-merge-sentinel/result.json",
    JSON.stringify(resultWithComment, null, 2),
  );
  core.setOutput("verdict", resultWithComment.verdict);
  core.setOutput("comment_url", resultWithComment.commentUrl);
  core.setOutput("result_json", JSON.stringify(resultWithComment));
}

function buildFinalResult(input: {
  metadata: Metadata;
  labels: Labels;
}): FinalResult {
  const changedFiles = parseChangedFiles(
    readFileSync(".self-merge-sentinel/changed-files.txt", "utf8"),
  );
  const rulesSources = [
    input.metadata.rulesSource,
    ...(input.metadata.extraRulesSources ?? []),
  ];
  let rules: RuleConfig;

  try {
    rules = mergeRuleConfigs(
      rulesSources.map((source) =>
        parseRuleConfig(readFileSync(source.path, "utf8")),
      ),
    );
  } catch (error) {
    return invalidRuleConfigResult({
      rulesSource: input.metadata.rulesSource,
      labels: input.labels,
      error,
    });
  }

  const deterministicMatches = findDeterministicMatches(rules, changedFiles);
  const aiJson = readFileSync(".self-merge-sentinel/ai-result.json", "utf8");

  return finalizeResult({
    aiJson,
    deterministicMatches,
    rulesSource: input.metadata.rulesSource,
    labels: input.labels,
  });
}

export function parseChangedFiles(content: string): string[] {
  return content
    .split("\n")
    .map((line) => (line.endsWith("\r") ? line.slice(0, -1) : line))
    .filter((line) => line !== "");
}

export async function tryUpsertComment(input: {
  upsert: () => Promise<string>;
  warn: (message: string) => void;
}): Promise<string> {
  try {
    return await input.upsert();
  } catch (error: unknown) {
    input.warn(`Self-merge sentinel comment update failed: ${errorMessage(error)}`);
    return "";
  }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function readJson<T>(path: string): T {
  return JSON.parse(readFileSync(path, "utf8")) as T;
}

if (isActionEntrypoint("main")) {
  runMain().catch((error: unknown) => {
    core.setFailed(error instanceof Error ? error.message : String(error));
  });
}

function isActionEntrypoint(name: string): boolean {
  const entrypoint = process.argv[1] ?? "";
  return entrypoint.endsWith(`${name}.js`) || entrypoint.endsWith(`${name}.cjs`);
}
