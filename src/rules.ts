import yaml from "js-yaml";
import picomatch from "picomatch";
import type {
  DeterministicMatch,
  RuleConfig,
} from "./types.js";

type RawRuleConfig = {
  version: 1;
  description: string;
  default_verdict: "HUMAN_REVIEW_REQUIRED";
  review_required_rules: RawReviewRequiredRule[];
};

type RawReviewRequiredRule = {
  id: string;
  description: string;
  match: {
    paths?: string[];
    semantic?: boolean;
  };
};

export function parseRuleConfig(content: string): RuleConfig {
  let parsed: unknown;

  try {
    parsed = yaml.load(content);
  } catch {
    throw new Error("Invalid self-merge rule config");
  }

  if (!isRawRuleConfig(parsed)) {
    throw new Error("Invalid self-merge rule config");
  }

  return {
    version: parsed.version,
    description: parsed.description,
    defaultVerdict: parsed.default_verdict,
    reviewRequiredRules: parsed.review_required_rules.map((rule) => ({
      id: rule.id,
      description: rule.description,
      match: {
        ...(rule.match.paths ? { paths: rule.match.paths } : {}),
        ...(rule.match.semantic === true ? { semantic: true } : {}),
      },
    })),
  };
}

export function mergeRuleConfigs(configs: RuleConfig[]): RuleConfig {
  const reviewRequiredRules = configs.flatMap(
    (config) => config.reviewRequiredRules,
  );
  const duplicateRuleId = findDuplicateRuleId(
    reviewRequiredRules.map((rule) => rule.id),
  );

  if (duplicateRuleId) {
    throw new Error(`Duplicate self-merge rule id: ${duplicateRuleId}`);
  }

  return {
    version: 1,
    description:
      configs.map((config) => config.description.trimEnd()).join("\n\n") + "\n",
    defaultVerdict: "HUMAN_REVIEW_REQUIRED",
    reviewRequiredRules,
  };
}

export function findDeterministicMatches(
  rules: RuleConfig,
  changedFiles: string[],
): DeterministicMatch[] {
  return rules.reviewRequiredRules.flatMap((rule) => {
    return (rule.match.paths ?? []).flatMap((pattern) => {
      const isMatch = picomatch(pattern, { dot: true });
      const files = changedFiles.filter((file) => isMatch(file));

      if (files.length === 0) {
        return [];
      }

      return [
        {
          ruleId: rule.id,
          description: rule.description,
          pattern,
          files,
        },
      ];
    });
  });
}

function isRawRuleConfig(value: unknown): value is RawRuleConfig {
  if (!isRecord(value)) {
    return false;
  }

  if (
    !hasOnlyKeys(value, [
      "version",
      "description",
      "default_verdict",
      "review_required_rules",
    ])
  ) {
    return false;
  }

  if (!Array.isArray(value.review_required_rules)) {
    return false;
  }

  return (
    value.version === 1 &&
    typeof value.description === "string" &&
    value.default_verdict === "HUMAN_REVIEW_REQUIRED" &&
    value.review_required_rules.every(isRawReviewRequiredRule) &&
    hasUniqueRuleIds(value.review_required_rules)
  );
}

function isRawReviewRequiredRule(value: unknown): value is RawReviewRequiredRule {
  if (!isRecord(value) || !isRecord(value.match)) {
    return false;
  }

  if (!hasOnlyKeys(value, ["id", "description", "match"])) {
    return false;
  }

  if (!hasOnlyKeys(value.match, ["paths", "semantic"])) {
    return false;
  }

  if (typeof value.id !== "string" || value.id.trim() === "") {
    return false;
  }

  if (typeof value.description !== "string" || value.description.trim() === "") {
    return false;
  }

  const paths = value.match.paths;
  const semantic = value.match.semantic;
  const hasPaths = paths !== undefined;
  const hasSemantic = semantic !== undefined;

  if (!hasPaths && !hasSemantic) {
    return false;
  }

  if (hasPaths && !isNonEmptyStringArray(paths)) {
    return false;
  }

  if (hasSemantic && semantic !== true) {
    return false;
  }

  return true;
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

function hasUniqueRuleIds(rules: RawReviewRequiredRule[]): boolean {
  return findDuplicateRuleId(rules.map((rule) => rule.id)) === null;
}

function findDuplicateRuleId(ruleIds: string[]): string | null {
  const seen = new Set<string>();

  for (const ruleId of ruleIds) {
    if (seen.has(ruleId)) {
      return ruleId;
    }

    seen.add(ruleId);
  }

  return null;
}

function isNonEmptyStringArray(value: unknown): value is string[] {
  return (
    Array.isArray(value) &&
    value.length > 0 &&
    value.every((item) => typeof item === "string" && item.trim() !== "")
  );
}
