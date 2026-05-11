import { describe, expect, it } from "vitest";
import {
  findExistingCommentId,
  isAlreadyExistsLabel,
  labelOperations,
} from "../src/github.js";

describe("findExistingCommentId", () => {
  const cases = [
    {
      name: "マーカーを含む既存コメントIDを返す",
      comments: [
        { id: 1, body: "unrelated" },
        { id: 2, body: "<!-- self-merge-sentinel -->\nbody" },
      ],
      marker: "<!-- self-merge-sentinel -->",
      expected: 2,
    },
    {
      name: "マーカーを含むコメントがなければ null を返す",
      comments: [
        { id: 1, body: "unrelated" },
        { id: 2 },
      ],
      marker: "<!-- self-merge-sentinel -->",
      expected: null,
    },
  ];

  it.each(cases)("$name", ({ comments, marker, expected }) => {
    const actual = findExistingCommentId(comments, marker);

    expect(actual).toEqual(expected);
  });
});

describe("labelOperations", () => {
  const cases = [
    {
      name: "ラベル更新が有効なら作成・付与・削除操作を返す",
      plan: {
        shouldUpdate: true,
        addLabel: "needs review",
        removeLabel: "self merge ok",
      } as const,
      expected: [
        { type: "ensure", label: "needs review" },
        { type: "add", label: "needs review" },
        { type: "remove", label: "self merge ok" },
      ],
    },
    {
      name: "ラベル更新が無効なら操作を返さない",
      plan: {
        shouldUpdate: false,
        addLabel: "",
        removeLabel: "",
      } as const,
      expected: [],
    },
  ];

  it.each(cases)("$name", ({ plan, expected }) => {
    const actual = labelOperations(plan);

    expect(actual).toEqual(expected);
  });
});

describe("isAlreadyExistsLabel", () => {
  const cases = [
    {
      name: "nameフィールドのalready_existsならtrueを返す",
      error: {
        status: 422,
        response: {
          data: {
            errors: [{ field: "name", code: "already_exists" }],
          },
        },
      },
      expected: true,
    },
    {
      name: "422でも別のvalidation errorならfalseを返す",
      error: {
        status: 422,
        response: {
          data: {
            errors: [{ field: "color", code: "invalid" }],
          },
        },
      },
      expected: false,
    },
    {
      name: "404ならfalseを返す",
      error: { status: 404 },
      expected: false,
    },
  ];

  it.each(cases)("$name", ({ error, expected }) => {
    const actual = isAlreadyExistsLabel(error);

    expect(actual).toEqual(expected);
  });
});
