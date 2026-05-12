import { load } from "js-yaml";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

type ActionYml = {
  inputs: Record<
    string,
    {
      required?: boolean;
      default?: string;
    }
  >;
  runs: {
    steps: Array<{
      name: string;
      uses?: string;
      with?: Record<string, string>;
      env?: Record<string, string>;
    }>;
  };
};

describe("action.yml", () => {
  it("Claude Code Action の Bedrock と Vertex 認証設定を委譲する", () => {
    const action = load(readFileSync("action.yml", "utf8")) as ActionYml;
    const classifyStep = action.runs.steps.find(
      (step) => step.name === "Classify with Claude",
    );

    const actual = {
      inputs: {
        anthropic_api_key: action.inputs.anthropic_api_key,
        use_bedrock: action.inputs.use_bedrock,
        use_vertex: action.inputs.use_vertex,
        base_url: action.inputs.base_url,
      },
      classifyStep: {
        uses: classifyStep?.uses,
        with: {
          anthropic_api_key: classifyStep?.with?.anthropic_api_key,
          use_bedrock: classifyStep?.with?.use_bedrock,
          use_vertex: classifyStep?.with?.use_vertex,
        },
        env: classifyStep?.env,
      },
    };

    expect(actual).toEqual({
      inputs: {
        anthropic_api_key: {
          description: "Claude Code Action compatible API key",
          required: false,
          default: "",
        },
        use_bedrock: {
          description:
            "Use Amazon Bedrock with OIDC authentication instead of direct Anthropic API",
          required: false,
          default: "false",
        },
        use_vertex: {
          description:
            "Use Google Vertex AI with OIDC authentication instead of direct Anthropic API",
          required: false,
          default: "false",
        },
        base_url: {
          description: "Anthropic-compatible API base URL",
          required: false,
          default: "",
        },
      },
      classifyStep: {
        uses: "anthropics/claude-code-action@v1",
        with: {
          anthropic_api_key: "${{ inputs.anthropic_api_key }}",
          use_bedrock: "${{ inputs.use_bedrock }}",
          use_vertex: "${{ inputs.use_vertex }}",
        },
        env: {
          AWS_REGION: "${{ env.AWS_REGION }}",
          AWS_ACCESS_KEY_ID: "${{ env.AWS_ACCESS_KEY_ID }}",
          AWS_SECRET_ACCESS_KEY: "${{ env.AWS_SECRET_ACCESS_KEY }}",
          AWS_SESSION_TOKEN: "${{ env.AWS_SESSION_TOKEN }}",
          AWS_BEARER_TOKEN_BEDROCK: "${{ env.AWS_BEARER_TOKEN_BEDROCK }}",
          ANTHROPIC_BEDROCK_BASE_URL:
            "${{ env.ANTHROPIC_BEDROCK_BASE_URL || (env.AWS_REGION && format('https://bedrock-runtime.{0}.amazonaws.com', env.AWS_REGION)) }}",
          ANTHROPIC_VERTEX_PROJECT_ID: "${{ env.ANTHROPIC_VERTEX_PROJECT_ID }}",
          CLOUD_ML_REGION: "${{ env.CLOUD_ML_REGION }}",
          GOOGLE_APPLICATION_CREDENTIALS:
            "${{ env.GOOGLE_APPLICATION_CREDENTIALS }}",
          ANTHROPIC_VERTEX_BASE_URL: "${{ env.ANTHROPIC_VERTEX_BASE_URL }}",
        },
      },
    });
  });
});
