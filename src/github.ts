import * as github from "@actions/github";
import type { LabelUpdatePlan } from "./types.js";

export type ExistingComment = {
  id: number;
  body?: string | null;
};

export type LabelOperation =
  | { type: "ensure"; label: string }
  | { type: "add"; label: string }
  | { type: "remove"; label: string };

export function findExistingCommentId(
  comments: ExistingComment[],
  marker: string,
): number | null {
  return comments.find((comment) => comment.body?.includes(marker))?.id ?? null;
}

export function labelOperations(plan: LabelUpdatePlan): LabelOperation[] {
  if (!plan.shouldUpdate) {
    return [];
  }

  return [
    { type: "ensure", label: plan.addLabel },
    { type: "add", label: plan.addLabel },
    { type: "remove", label: plan.removeLabel },
  ];
}

export async function upsertComment(input: {
  token: string;
  owner: string;
  repo: string;
  issueNumber: number;
  marker: string;
  body: string;
}): Promise<string> {
  const octokit = github.getOctokit(input.token);
  const comments = await octokit.rest.issues.listComments({
    owner: input.owner,
    repo: input.repo,
    issue_number: input.issueNumber,
    per_page: 100,
  });
  const existingCommentId = findExistingCommentId(comments.data, input.marker);

  if (existingCommentId !== null) {
    const updated = await octokit.rest.issues.updateComment({
      owner: input.owner,
      repo: input.repo,
      comment_id: existingCommentId,
      body: input.body,
    });

    return updated.data.html_url;
  }

  const created = await octokit.rest.issues.createComment({
    owner: input.owner,
    repo: input.repo,
    issue_number: input.issueNumber,
    body: input.body,
  });

  return created.data.html_url;
}

export async function applyLabels(input: {
  token: string;
  owner: string;
  repo: string;
  issueNumber: number;
  plan: LabelUpdatePlan;
}): Promise<void> {
  const octokit = github.getOctokit(input.token);

  for (const operation of labelOperations(input.plan)) {
    if (operation.type === "ensure") {
      await ensureLabel({
        token: input.token,
        owner: input.owner,
        repo: input.repo,
        label: operation.label,
      });
    }

    if (operation.type === "add") {
      await octokit.rest.issues.addLabels({
        owner: input.owner,
        repo: input.repo,
        issue_number: input.issueNumber,
        labels: [operation.label],
      });
    }

    if (operation.type === "remove") {
      try {
        await octokit.rest.issues.removeLabel({
          owner: input.owner,
          repo: input.repo,
          issue_number: input.issueNumber,
          name: operation.label,
        });
      } catch (error) {
        if (!isNotFound(error)) {
          throw error;
        }
      }
    }
  }
}

async function ensureLabel(input: {
  token: string;
  owner: string;
  repo: string;
  label: string;
}): Promise<void> {
  const octokit = github.getOctokit(input.token);

  try {
    await octokit.rest.issues.getLabel({
      owner: input.owner,
      repo: input.repo,
      name: input.label,
    });
  } catch (error) {
    if (!isNotFound(error)) {
      throw error;
    }

    try {
      await octokit.rest.issues.createLabel({
        owner: input.owner,
        repo: input.repo,
        name: input.label,
        color: defaultLabelColor(),
        description: defaultLabelDescription(),
      });
    } catch (createError) {
      if (!isAlreadyExistsLabel(createError)) {
        throw createError;
      }
    }
  }
}

function defaultLabelColor(): string {
  return "ededed";
}

function defaultLabelDescription(): string {
  return "Managed by self-merge sentinel";
}

function isNotFound(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "status" in error &&
    (error as { status: unknown }).status === 404
  );
}

export function isAlreadyExistsLabel(error: unknown): boolean {
  return (
    isRecord(error) &&
    error.status === 422 &&
    isRecord(error.response) &&
    isRecord(error.response.data) &&
    Array.isArray(error.response.data.errors) &&
    error.response.data.errors.some((validationError) => {
      return (
        isRecord(validationError) &&
        validationError.code === "already_exists" &&
        validationError.field === "name"
      );
    })
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
