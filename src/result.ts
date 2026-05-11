import type {
  AiClassification,
  DeterministicMatch,
  FinalResult,
  Source,
  SuccessfulVerdict,
} from "./types.js";
import { labelUpdateForVerdict } from "./labels.js";

export type FinalizeResultInput = {
  aiJson: string;
  deterministicMatches: DeterministicMatch[];
  rulesSource: Source;
  labels: {
    allowed: string;
    humanRequired: string;
  };
};

export function invalidRuleConfigResult(input: {
  rulesSource: Source;
  labels: {
    allowed: string;
    humanRequired: string;
  };
  error: unknown;
}): FinalResult {
  return {
    verdict: "AI_CLASSIFICATION_FAILED",
    aiVerdict: null,
    summary:
      "rules の読み込みに失敗したため、この自動判定だけではセルフマージ可否を判断できません。",
    deterministicMatches: [],
    aiTriggeredRules: [],
    rulesSource: input.rulesSource,
    filesConsidered: [],
    labelUpdate: labelUpdateForVerdict("AI_CLASSIFICATION_FAILED", input.labels),
    error: {
      code: "INVALID_RULE_CONFIG",
      message:
        input.error instanceof Error
          ? input.error.message
          : "Invalid self-merge rule config",
    },
  };
}

export function parseAiClassification(aiJson: string): AiClassification {
  let parsed: unknown;

  try {
    parsed = JSON.parse(aiJson);
  } catch {
    throw new Error("Claude structured output is not valid JSON");
  }

  if (!isAiClassification(parsed)) {
    throw new Error("Claude structured output does not match the expected schema");
  }

  return parsed;
}

export function finalizeResult(input: FinalizeResultInput): FinalResult {
  const hasDeterministicMatches = input.deterministicMatches.length > 0;
  let ai: AiClassification;

  try {
    ai = parseAiClassification(input.aiJson);
  } catch (error) {
    if (hasDeterministicMatches) {
      return {
        verdict: "HUMAN_REVIEW_REQUIRED",
        aiVerdict: null,
        summary:
          "AI判定には失敗しましたが、決定的ルールに一致したため、人間レビューが必要です。",
        deterministicMatches: input.deterministicMatches,
        aiTriggeredRules: [],
        rulesSource: input.rulesSource,
        filesConsidered: deterministicMatchFiles(input.deterministicMatches),
        labelUpdate: labelUpdateForVerdict("HUMAN_REVIEW_REQUIRED", input.labels),
        error: {
          code: "INVALID_AI_OUTPUT",
          message: error instanceof Error ? error.message : "Unknown AI output error",
        },
      };
    }

    return {
      verdict: "AI_CLASSIFICATION_FAILED",
      aiVerdict: null,
      summary:
        "AI判定に失敗したため、この自動判定だけではセルフマージ可否を判断できません。",
      deterministicMatches: input.deterministicMatches,
      aiTriggeredRules: [],
      rulesSource: input.rulesSource,
      filesConsidered: [],
      labelUpdate: labelUpdateForVerdict("AI_CLASSIFICATION_FAILED", input.labels),
      error: {
        code: "INVALID_AI_OUTPUT",
        message: error instanceof Error ? error.message : "Unknown AI output error",
      },
    };
  }

  const verdict: SuccessfulVerdict = hasDeterministicMatches
    ? "HUMAN_REVIEW_REQUIRED"
    : ai.verdict;

  return {
    verdict,
    aiVerdict: ai.verdict,
    summary: hasDeterministicMatches
      ? "決定的ルールに一致したため、人間レビューが必要です。"
      : ai.summary,
    deterministicMatches: input.deterministicMatches,
    aiTriggeredRules: ai.triggered_rules,
    rulesSource: input.rulesSource,
    filesConsidered: ai.files_considered,
    labelUpdate: labelUpdateForVerdict(verdict, input.labels),
  };
}

function deterministicMatchFiles(matches: DeterministicMatch[]): string[] {
  return Array.from(new Set(matches.flatMap((match) => match.files)));
}

function isAiClassification(value: unknown): value is AiClassification {
  if (!isRecord(value)) {
    return false;
  }

  if (
    !hasOnlyKeys(value, [
      "verdict",
      "summary",
      "triggered_rules",
      "safe_to_self_merge_reason",
      "human_review_reason",
      "files_considered",
    ])
  ) {
    return false;
  }

  return (
    isSuccessfulVerdict(value.verdict) &&
    typeof value.summary === "string" &&
    isTriggeredRules(value.triggered_rules) &&
    isStringArray(value.files_considered) &&
    isOptionalString(value.safe_to_self_merge_reason) &&
    isOptionalString(value.human_review_reason)
  );
}

function isTriggeredRules(
  value: unknown,
): value is AiClassification["triggered_rules"] {
  return Array.isArray(value) && value.every(isTriggeredRule);
}

function isTriggeredRule(
  value: unknown,
): value is AiClassification["triggered_rules"][number] {
  if (!isRecord(value)) {
    return false;
  }

  if (!hasOnlyKeys(value, ["rule_id", "reason", "files"])) {
    return false;
  }

  return (
    typeof value.rule_id === "string" &&
    typeof value.reason === "string" &&
    isStringArray(value.files)
  );
}

function isSuccessfulVerdict(value: unknown): value is SuccessfulVerdict {
  return value === "SELF_MERGE_ALLOWED" || value === "HUMAN_REVIEW_REQUIRED";
}

function isOptionalString(value: unknown): value is string | undefined {
  return value === undefined || typeof value === "string";
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === "string");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasOnlyKeys(
  value: Record<string, unknown>,
  allowedKeys: string[],
): boolean {
  return Object.keys(value).every((key) => allowedKeys.includes(key));
}
