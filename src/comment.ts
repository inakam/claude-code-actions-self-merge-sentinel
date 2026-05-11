import type { FinalResult } from "./types.js";

export function renderComment(result: FinalResult, marker: string): string {
  const title = titleFor(result.verdict);
  const details = renderDetails(result);
  const labelNotice = result.labelUpdate.shouldUpdate
    ? ""
    : "\nラベルは更新していません。\n";

  return `${marker}

## セルフマージ判定: ${title}

${escapeMarkdownText(result.summary)}

**判定:** ${inlineCode(result.verdict)}
${labelNotice}
<details>
<summary>判定の詳細</summary>

${details}
</details>
`;
}

function titleFor(verdict: FinalResult["verdict"]): string {
  switch (verdict) {
    case "SELF_MERGE_ALLOWED":
      return "セルフマージ可";
    case "HUMAN_REVIEW_REQUIRED":
      return "人間レビュー必須";
    case "AI_CLASSIFICATION_FAILED":
      return "判定失敗";
    case "SKIPPED_UNSUPPORTED_FORK":
      return "対象外";
  }
}

function renderDetails(result: FinalResult): string {
  const lines = [
    "### Rules設定",
    "",
    `- source: ${inlineCode(`${result.rulesSource.kind}:${result.rulesSource.path}`)}`,
  ];

  if (result.deterministicMatches.length > 0) {
    lines.push("", "### 決定的ルール", "");

    for (const match of result.deterministicMatches) {
      const files = match.files.map((file) => inlineCode(file)).join(", ");
      lines.push(
        `- rule_id: ${inlineCode(match.ruleId)} / pattern: ${inlineCode(match.pattern)} / files: ${files}`,
      );
    }
  }

  if (result.aiTriggeredRules.length > 0) {
    lines.push("", "### AI triggered rules", "");

    for (const rule of result.aiTriggeredRules) {
      const files = rule.files.map((file) => inlineCode(file)).join(", ");
      lines.push(
        `- rule_id: ${inlineCode(rule.rule_id)} / files: ${files} / reason: ${escapeMarkdownText(rule.reason)}`,
      );
    }
  }

  if (result.aiVerdict !== null) {
    lines.push("", "### AI判定", "", `- ${inlineCode(result.aiVerdict)}`);
  }

  if (result.filesConsidered.length > 0) {
    lines.push("", "### 考慮したファイル", "");

    for (const file of result.filesConsidered) {
      lines.push(`- ${inlineCode(file)}`);
    }
  }

  if (result.error) {
    lines.push(
      "",
      "### エラー",
      "",
      `- ${inlineCode(result.error.code)}: ${escapeMarkdownText(result.error.message)}`,
    );
  }

  lines.push("");
  return lines.join("\n");
}

function inlineCode(value: string): string {
  const longestRun = longestBacktickRun(value);
  const delimiter = "`".repeat(longestRun + 1);
  const needsPadding = value.startsWith("`") || value.endsWith("`");
  const content = needsPadding ? ` ${value} ` : value;

  return `${delimiter}${content}${delimiter}`;
}

function escapeMarkdownText(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll("@", "&#64;");
}

function longestBacktickRun(value: string): number {
  return Math.max(0, ...Array.from(value.matchAll(/`+/g), (match) => match[0].length));
}
