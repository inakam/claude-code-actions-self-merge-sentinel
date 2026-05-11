import type { LabelUpdatePlan, Verdict } from "./types.js";

export function labelUpdateForVerdict(
  verdict: Verdict,
  labels: { allowed: string; humanRequired: string },
): LabelUpdatePlan {
  if (verdict === "SELF_MERGE_ALLOWED") {
    return {
      shouldUpdate: true,
      addLabel: labels.allowed,
      removeLabel: labels.humanRequired,
    };
  }

  if (verdict === "HUMAN_REVIEW_REQUIRED") {
    return {
      shouldUpdate: true,
      addLabel: labels.humanRequired,
      removeLabel: labels.allowed,
    };
  }

  return {
    shouldUpdate: false,
    addLabel: "",
    removeLabel: "",
  };
}
