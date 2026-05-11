export type Verdict =
  | "SELF_MERGE_ALLOWED"
  | "HUMAN_REVIEW_REQUIRED"
  | "AI_CLASSIFICATION_FAILED"
  | "SKIPPED_UNSUPPORTED_FORK";

export type SuccessfulVerdict = "SELF_MERGE_ALLOWED" | "HUMAN_REVIEW_REQUIRED";

export type SourceKind = "action-default" | "repository";

export type Source = {
  kind: SourceKind;
  path: string;
};

export type RuleConfig = {
  version: 1;
  description: string;
  defaultVerdict: "HUMAN_REVIEW_REQUIRED";
  reviewRequiredRules: ReviewRequiredRule[];
};

export type ReviewRequiredRule = {
  id: string;
  description: string;
  match: {
    paths?: string[];
    semantic?: boolean;
  };
};

export type DeterministicMatch = {
  ruleId: string;
  description: string;
  pattern: string;
  files: string[];
};

export type AiVerdict = SuccessfulVerdict;

export type AiTriggeredRule = {
  rule_id: string;
  reason: string;
  files: string[];
};

export type AiClassification = {
  verdict: AiVerdict;
  summary: string;
  triggered_rules: AiTriggeredRule[];
  safe_to_self_merge_reason?: string;
  human_review_reason?: string;
  files_considered: string[];
};

export type LabelUpdatePlan =
  | {
      shouldUpdate: true;
      addLabel: string;
      removeLabel: string;
    }
  | {
      shouldUpdate: false;
      addLabel: "";
      removeLabel: "";
    };

export type FinalResult = {
  verdict: Verdict;
  aiVerdict: AiVerdict | null;
  summary: string;
  deterministicMatches: DeterministicMatch[];
  aiTriggeredRules: AiTriggeredRule[];
  rulesSource: Source;
  filesConsidered: string[];
  labelUpdate: LabelUpdatePlan;
  error?: {
    code: string;
    message: string;
  };
  commentUrl?: string;
};
