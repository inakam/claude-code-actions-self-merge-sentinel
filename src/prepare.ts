import * as core from "@actions/core";
import * as github from "@actions/github";
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import type { Source } from "./types.js";

const missingPrNumberMessage = "PR number is required for self-merge sentinel";

type RepositoryNames = {
  headRepositoryFullName: string | null;
  baseRepositoryFullName: string | null;
};

type FetchRepositoryNames = (input: {
  token: string;
  prNumber: number;
}) => Promise<RepositoryNames>;

export function resolvePrNumber(input: {
  explicit: string;
  eventPullRequestNumber: number | undefined;
}): number {
  const explicit = input.explicit.trim();
  if (explicit !== "") {
    const prNumber = Number(explicit);
    if (isValidPrNumber(prNumber)) {
      return prNumber;
    }

    throw new Error(missingPrNumberMessage);
  }

  if (isValidPrNumber(input.eventPullRequestNumber)) {
    return input.eventPullRequestNumber;
  }

  throw new Error(missingPrNumberMessage);
}

export function resolveSource(input: {
  repositoryPath: string;
  defaultPath: string;
}): Source {
  const repositoryPath = input.repositoryPath.trim();
  if (repositoryPath !== "") {
    return {
      kind: "repository",
      path: repositoryPath,
    };
  }

  return {
    kind: "action-default",
    path: input.defaultPath,
  };
}

export function parseExtraRulesPaths(content: string): string[] {
  return content
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line !== "");
}

export function isUnsupportedForkPullRequest(): boolean {
  const pullRequest = github.context.payload.pull_request;

  if (!pullRequest) {
    return false;
  }

  const headRepo = pullRequest.head.repo;
  const baseRepo = pullRequest.base.repo;

  if (!headRepo || !baseRepo) {
    return true;
  }

  return headRepo.full_name !== baseRepo.full_name;
}

export async function resolveUnsupportedForkPullRequest(input: {
  prNumber: number;
  token: string;
  fetchRepositoryNames?: FetchRepositoryNames;
}): Promise<boolean> {
  if (github.context.payload.pull_request) {
    return isUnsupportedForkPullRequest();
  }

  const fetchRepositoryNames = input.fetchRepositoryNames ?? fetchPullRequestRepositoryNames;
  const repositoryNames = await fetchRepositoryNames({
    token: input.token,
    prNumber: input.prNumber,
  });

  return isUnsupportedForkRepositories(repositoryNames);
}

export function isUnsupportedForkRepositories(input: RepositoryNames): boolean {
  if (!input.headRepositoryFullName || !input.baseRepositoryFullName) {
    return true;
  }

  return input.headRepositoryFullName !== input.baseRepositoryFullName;
}

export async function runPrepare(): Promise<void> {
  const actionPath = resolve(process.env.GITHUB_ACTION_PATH ?? ".");
  const prNumber = resolvePrNumber({
    explicit: core.getInput("pr_number"),
    eventPullRequestNumber: github.context.payload.pull_request?.number,
  });
  const token = core.getInput("github_token", { required: true });

  const rulesSource = resolveSource({
    repositoryPath: core.getInput("rules_path"),
    defaultPath: resolve(actionPath, "rules/default.yml"),
  });
  const extraRulesSources = parseExtraRulesPaths(
    core.getInput("extra_rules_paths"),
  ).map((path) => ({
    kind: "repository" as const,
    path,
  }));
  const rulesSources = [rulesSource, ...extraRulesSources];
  const unsupportedFork = await resolveUnsupportedForkPullRequest({ prNumber, token });
  const metadata = {
    prNumber,
    unsupportedFork,
    rulesSource,
    extraRulesSources,
  };

  mkdirSync(".self-merge-sentinel", { recursive: true });
  writeFileSync(
    ".self-merge-sentinel/metadata.json",
    JSON.stringify(metadata, null, 2),
  );
  core.setOutput("pr_number", String(prNumber));
  core.setOutput("unsupported_fork", String(unsupportedFork));
  core.setOutput("rules_path", rulesSource.path);
  core.setOutput(
    "rules_paths",
    rulesSources.map((source) => source.path).join("\n"),
  );
}

if (isActionEntrypoint("prepare")) {
  runPrepare().catch((error: unknown) => {
    core.setFailed(error instanceof Error ? error.message : String(error));
  });
}

function isActionEntrypoint(name: string): boolean {
  const entrypoint = process.argv[1] ?? "";
  return entrypoint.endsWith(`${name}.js`) || entrypoint.endsWith(`${name}.cjs`);
}

function isValidPrNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value > 0;
}

async function fetchPullRequestRepositoryNames(input: {
  token: string;
  prNumber: number;
}): Promise<RepositoryNames> {
  const octokit = github.getOctokit(input.token);
  const response = await octokit.rest.pulls.get({
    owner: github.context.repo.owner,
    repo: github.context.repo.repo,
    pull_number: input.prNumber,
  });

  return {
    headRepositoryFullName: response.data.head.repo?.full_name ?? null,
    baseRepositoryFullName: response.data.base.repo?.full_name ?? null,
  };
}
