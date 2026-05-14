# Claude Code Actions Self Merge Sentinel

PRごとに「セルフマージ可」か「人間レビュー必須」かを判定し、根拠つきコメントとラベルを更新する GitHub Action です。

判断原則、パスルール、意味判定ルールはすべて1つの rules YAML に書きます。

## 特徴

- **PRごとの判定コメント**: `SELF_MERGE_ALLOWED` または `HUMAN_REVIEW_REQUIRED` を根拠つきでPRに投稿します。
- **ラベル更新**: `self-merge: allowed` または `review: human-required` を最新判定に合わせて更新します。
- **rules-only 設定**: `rules/default.yml`、利用先リポジトリの `rules_path`、追加の `extra_rules_paths` を判定ソースにします。
- **決定的ルール優先**: `match.paths` に一致した変更はAI判断に関係なく人間レビュー必須にします。
- **意味判定もID付きで管理**: `match.semantic: true` のルールはClaudeに判定させ、コメントには該当 `id` を出せます。
- **標準 Anthropic 構成**: 通常は `ANTHROPIC_API_KEY` だけで Claude Code Action の標準 provider を使えます。
- **クラウド provider 対応**: Claude Code Action と同じ `use_bedrock` / `use_vertex` と runner の AWS/GCP 認証 env を使えます。
- **カスタマイズ可能**: Anthropic-compatible API の `base_url`、`model`、timeout、thinking tokens、ラベル名を必要に応じて変更できます。

## 事前準備

### Claude の認証を用意する

この action は内部で `anthropics/claude-code-action@v1` を使います。標準構成では、利用先リポジトリに `ANTHROPIC_API_KEY` を GitHub Actions secret として登録してください。

```bash
gh secret set ANTHROPIC_API_KEY --body "your-anthropic-api-key"
```

GitHub UI から登録する場合は、利用先リポジトリの `Settings` -> `Secrets and variables` -> `Actions` -> `New repository secret` で `ANTHROPIC_API_KEY` を追加します。

Amazon Bedrock または Google Vertex AI を使う場合は `anthropic_api_key` は不要です。workflow 側で Claude Code Action と同じ OIDC / credential 設定を行い、この action に `use_bedrock: "true"` または `use_vertex: "true"` を渡してください。

### GITHUB_TOKEN について

`${{ secrets.GITHUB_TOKEN }}` は GitHub Actions が workflow 実行ごとに自動で用意する token です。通常、利用者が repository secret として手動登録する必要はありません。

ただし、この action は PR diff の取得、PRコメント、ラベル更新を行うため、workflow 側で次の `permissions` を明示してください。

```yaml
permissions:
  contents: read
  pull-requests: write
  issues: write
```

## 使い方

`.github/workflows/self-merge-sentinel.yml` を作成します。

```yaml
name: Self Merge Sentinel

on:
  pull_request:
    types: [opened, synchronize, reopened, ready_for_review]
  workflow_dispatch:
    inputs:
      pr_number:
        description: "判定するPR番号"
        required: true

permissions:
  contents: read
  pull-requests: write
  issues: write

jobs:
  classify:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v5
        with:
          fetch-depth: 0

      - uses: inakam/claude-code-actions-self-merge-sentinel@v1
        with:
          anthropic_api_key: ${{ secrets.ANTHROPIC_API_KEY }}
          github_token: ${{ secrets.GITHUB_TOKEN }}
          pr_number: ${{ github.event.inputs.pr_number }}
```

この action は `dist/` に依存込みでバンドル済みの Node.js スクリプトを含むため、利用先の workflow で `npm install` は不要です。
対象 PR 番号は、`pull_request` イベントや PR への `issue_comment` イベントから自動で解決します。
`workflow_dispatch` など GitHub イベントから PR を特定できない場合だけ、`pr_number` を明示してください。

## Rules の考え方

rules YAML は、次の3つを1ファイルにまとめたものです。

- `description`: 判断原則。Claudeに読ませる運用ポリシーです。
- `review_required_rules[].match.paths`: ファイルパスだけで決定できる人間レビュー必須ルールです。
- `review_required_rules[].match.semantic`: パスだけでは決められない意味的な人間レビュー必須ルールです。

デフォルトでは action 同梱の `rules/default.yml` を使います。利用先リポジトリでベース rules を差し替える場合は、たとえば `.github/self-merge-rules.yml` を作成して `rules_path` を指定します。

```yaml
      - uses: inakam/claude-code-actions-self-merge-sentinel@v1
        with:
          anthropic_api_key: ${{ secrets.ANTHROPIC_API_KEY }}
          github_token: ${{ secrets.GITHUB_TOKEN }}
          rules_path: .github/self-merge-rules.yml
```

デフォルト rules を維持したままチーム固有の rules を足す場合は、`extra_rules_paths` を改行区切りで指定します。

```yaml
      - uses: inakam/claude-code-actions-self-merge-sentinel@v1
        with:
          anthropic_api_key: ${{ secrets.ANTHROPIC_API_KEY }}
          github_token: ${{ secrets.GITHUB_TOKEN }}
          extra_rules_paths: |
            .github/self-merge-rules.database.yml
            .github/self-merge-rules.security.yml
```

`extra_rules_paths` の各ファイルも、`version`、`description`、`default_verdict`、`review_required_rules` を持つ完全な rules YAML である必要があります。

`review_required_rules[].id` が重複した場合は設定エラーとして扱い、人間レビュー必須に倒します。

## Rules YAML の書き方

最小例:

```yaml
version: 1

description: |
  セルフマージ可否は、その変更が容易にやり直せるかで判断する。
  判断に迷う場合は人間レビュー必須とする。
  AIの判定は最終承認ではなく、PR作成者とチームの判断材料である。

default_verdict: "HUMAN_REVIEW_REQUIRED"

review_required_rules:
  - id: "database-change"
    description: "DB schema, migration, seed, destructive DDL"
    match:
      paths:
        - "db/**"
        - "**/schema.sql"

  - id: "foundational-library-change"
    description: "Adds, replaces, or removes a foundational library or framework"
    match:
      semantic: true
```

### `version`

現在は `1` のみ対応しています。将来 rules の形式を変える場合に互換性を切るためのフィールドです。

```yaml
version: 1
```

### `description`

セルフマージ判断の原則を書きます。ここはAIが読む文章です。

```yaml
description: |
  セルフマージ可否は、その変更が容易にやり直せるかで判断する。
  容易に revert でき、ユーザー・データ・セキュリティ・基盤設計への不可逆な影響が小さい変更はセルフマージ可。
  revert しても被害が残る、またはチーム・プロダクト全体に長期的な影響を与える変更は人間レビュー必須。
  判断に迷う場合は人間レビュー必須とする。
```

`description` は判定時の前提としてClaudeに渡すものです。人間が読み返したときに運用意図が分かる粒度で書くのが向いています。

### `default_verdict`

判断不能時の倒し先です。現在は安全側に倒すため `HUMAN_REVIEW_REQUIRED` のみ対応しています。

```yaml
default_verdict: "HUMAN_REVIEW_REQUIRED"
```

### `review_required_rules`

人間レビュー必須にする条件を配列で書きます。各ルールには固有の `id` を付けます。

```yaml
review_required_rules:
  - id: "auth-or-authorization-change"
    description: "Authentication, authorization, session, permission, or tenant isolation behavior"
    match:
      paths:
        - "src/**/auth/**"
        - "app/api/auth/**"
      semantic: true
```

`id` はPRコメントの `triggered_rules[].rule_id` に使われます。後から「なぜ人間レビュー必須になったのか」を追えるように、短いid名にしてください。

### `match.paths`

ファイルパスだけで判断できる場合に使います。PRの変更ファイルが1つでも一致すると、AIの意味判定に関係なく `HUMAN_REVIEW_REQUIRED` になります。

```yaml
review_required_rules:
  - id: "database-change"
    description: "DB schema, migration, seed, destructive DDL"
    match:
      paths:
        - "db/**"
        - "**/schema.sql"
```

パターンは `picomatch` で評価します。dotfile も対象です。

よく使う例:

```yaml
paths:
  - "db/**"
  - "**/schema.sql"
  - "infra/**"
  - ".github/workflows/deploy*.yml"
  - "src/**/auth/**"
  - "middleware.ts"
```

デフォルトの `database-change` は `db/**` と `**/schema.sql` だけです。`prisma/migrations/**` などを指定したい場合は、利用先リポジトリの rules で明示してください。

### `match.semantic`

パスだけでは判断できない変更をAIに意味判定させる場合に使います。値は `true` のみです。

```yaml
review_required_rules:
  - id: "public-api-contract-change"
    description: "Changes public API contracts in a way that may affect external clients"
    match:
      semantic: true
```

`semantic: true` のルールは、差分内容を読まないと判断できないものに向いています。

- 基盤ライブラリやフレームワークの追加・置換・削除
- マネージドサービスの追加
- 公開APIパスの破壊的変更
- 横断的な middleware、logging、error handling、observability、request lifecycle の変更
- rollback が難しい、または rollback しても影響が残る変更

`paths` と `semantic` は同じルールに両方書けます。その場合、パス一致は決定的に人間レビュー必須、パスでは拾えない変更はAIの意味判定対象になります。

## デフォルト Rules

同梱の `rules/default.yml` は次の方針です。

- セルフマージ可否は「その変更が容易にやり直せるか」で判断する。
- 判断に迷う場合は人間レビュー必須にする。
- AIの判定は最終承認ではなく、PR作成者とチームの判断材料にする。

デフォルトで含まれるルール:

| id | 判定方法 | 概要 |
| --- | --- | --- |
| `database-change` | paths | `db/**` と `**/schema.sql` |
| `auth-or-authorization-change` | paths + semantic | 認証、認可、session、permission、tenant isolation |
| `infrastructure-or-release-change` | paths + semantic | infra、deploy、release、本番 runtime |
| `foundational-library-change` | semantic | 基盤ライブラリやフレームワークの追加・置換・削除 |
| `public-api-contract-change` | semantic | 外部利用者に影響しうる公開API変更 |
| `hard-to-rollback-change` | semantic | rollback が難しい、または不完全・危険な変更 |

## 判定の流れ

1. `rules_path` があればその YAML をベースとして読み、なければ同梱の `rules/default.yml` をベースとして使います。
2. `extra_rules_paths` があれば、指定された rules YAML をベースに追加します。
3. action 側で rules YAML を parse、merge、validate します。壊れた rules は設定エラーとして `prepare` で失敗します。
4. `match.paths` を action 側で決定的に評価します。
5. パス一致がある場合、最終判定は `HUMAN_REVIEW_REQUIRED` になります。
6. rules YAML 全体ではなく、action 側で検証済みの top-level `description` と、`match.semantic: true` の semantic rule を `id: description` 形式に正規化した prompt 文字列だけを Claude Code Action の `prompt` 本文に直接展開します。
7. Claude Code Action に変更ファイル一覧と diff を読ませ、正規化済み semantic rules prompt と実際の変更から structured output を生成します。
8. action 側でAI出力を検証し、未知キーや不正な構造は `AI_CLASSIFICATION_FAILED` として soft failure にします。
9. 判定コメントを upsert し、`self-merge: allowed` または `review: human-required` ラベルを更新します。

AIは approve、merge、コメント投稿、ラベル更新を直接行いません。

Claude Code Action は structured output を返すだけで、コメントとラベルはこの action の TypeScript script が更新します。

## Anthropic-compatible provider

GLM など Anthropic-compatible API を使う場合も、Action の input 名は `anthropic_api_key` のままです。渡す secret と `base_url` だけを provider に合わせてください。

```yaml
- uses: inakam/claude-code-actions-self-merge-sentinel@v1
  with:
    anthropic_api_key: ${{ secrets.GLM_API_KEY }}
    base_url: https://api.z.ai/api/anthropic
    github_token: ${{ secrets.GITHUB_TOKEN }}
```

必要な provider でだけ `model`、`max_thinking_tokens`、`api_timeout_ms` を指定してください。未指定の値は Claude Code Action に渡しません。

## Amazon Bedrock / Google Vertex AI

Claude Code Action の `use_bedrock` / `use_vertex` と同じ認証を、この action でも利用できます。AWS/GCP の認証ステップで設定された env は `Classify with Claude` ステップへ渡されます。

Amazon Bedrock の例:

```yaml
permissions:
  contents: read
  pull-requests: write
  issues: write
  id-token: write

steps:
  - uses: actions/checkout@v5
  - uses: aws-actions/configure-aws-credentials@v5
    with:
      role-to-assume: ${{ secrets.AWS_ROLE_TO_ASSUME }}
      aws-region: us-west-2
  - uses: inakam/claude-code-actions-self-merge-sentinel@v1
    with:
      use_bedrock: "true"
      github_token: ${{ secrets.GITHUB_TOKEN }}
```

Google Vertex AI の例:

```yaml
permissions:
  contents: read
  pull-requests: write
  issues: write
  id-token: write

env:
  ANTHROPIC_VERTEX_PROJECT_ID: ${{ vars.GCP_PROJECT_ID }}
  CLOUD_ML_REGION: us-east5

steps:
  - uses: actions/checkout@v5
  - uses: google-github-actions/auth@v3
    with:
      workload_identity_provider: ${{ secrets.GCP_WORKLOAD_IDENTITY_PROVIDER }}
      service_account: ${{ secrets.GCP_SERVICE_ACCOUNT }}
  - uses: inakam/claude-code-actions-self-merge-sentinel@v1
    with:
      use_vertex: "true"
      github_token: ${{ secrets.GITHUB_TOKEN }}
```

## 入力

| 名前 | 必須 | デフォルト | 説明 |
| --- | --- | --- | --- |
| `anthropic_api_key` | no | | Claude Code Action に渡す Anthropic API key。Anthropic-compatible provider を使う場合もこの input に provider 用 secret を渡します。Bedrock/Vertex では不要です。 |
| `github_token` | yes | | PR diff、コメント、ラベル更新に使う GitHub token。通常は `${{ secrets.GITHUB_TOKEN }}` を渡します。 |
| `base_url` | no | | Anthropic-compatible API の base URL。空なら Claude Code Action の標準 provider を使います。 |
| `use_bedrock` | no | `false` | Amazon Bedrock の OIDC 認証を使う場合に `true` を指定します。 |
| `use_vertex` | no | `false` | Google Vertex AI の OIDC 認証を使う場合に `true` を指定します。 |
| `model` | no | | Claude Code Action に渡す model 名。空なら Claude Code Action 側の既定値に任せます。 |
| `max_thinking_tokens` | no | | 最大 thinking tokens。必要な provider でだけ指定します。 |
| `api_timeout_ms` | no | | API timeout milliseconds。必要な provider でだけ指定します。 |
| `rules_path` | no | | 利用先リポジトリに置いた rules YAML のパス。未指定なら同梱の `rules/default.yml` を使います。 |
| `extra_rules_paths` | no | | ベース rules に追加する rules YAML のパス一覧。改行区切りで指定します。 |
| `allowed_label` | no | `self-merge: allowed` | セルフマージ可 PR に付けるラベル。 |
| `human_required_label` | no | `review: human-required` | 人間レビュー必須 PR に付けるラベル。 |
| `comment_marker` | no | `<!-- self-merge-sentinel -->` | PRコメントを更新するための marker。 |
| `max_turns` | no | `8` | Claude Code Action の max turns。 |
| `pr_number` | no | | GitHub イベントから PR を特定できない場合に明示する PR 番号。通常の `pull_request` や PR への `issue_comment` では自動解決します。 |

## 出力

| 名前 | 説明 |
| --- | --- |
| `verdict` | `SELF_MERGE_ALLOWED`、`HUMAN_REVIEW_REQUIRED`、`AI_CLASSIFICATION_FAILED`、`SKIPPED_UNSUPPORTED_FORK` のいずれか。 |
| `comment_url` | sentinel コメントの URL。コメント投稿に失敗した場合は空文字です。 |
| `result_json` | 判定結果全体の JSON。 |

## ラベル

デフォルトでは次のラベルを使います。

- `self-merge: allowed`
- `review: human-required`

ラベルが存在しない場合は action が作成します。ラベル名を変えたい場合は `allowed_label` と `human_required_label` を指定してください。

```yaml
- uses: inakam/claude-code-actions-self-merge-sentinel@v1
  with:
    anthropic_api_key: ${{ secrets.ANTHROPIC_API_KEY }}
    github_token: ${{ secrets.GITHUB_TOKEN }}
    allowed_label: "self-merge-ok"
    human_required_label: "needs-human-review"
```

## セキュリティ

- `pull_request_target` で untrusted fork code を checkout して、この action を secrets 付きで実行しないでください。
- fork PR はこの action では判定せず、`SKIPPED_UNSUPPORTED_FORK` として扱います。
- fork PR を本格的に判定したい場合は、secrets を使う処理と untrusted code の checkout を分離する別設計が必要です。
- Claude には PR diff を信頼できない入力として扱うよう指示しています。
- PR diff、PR本文、コメント、コード中の指示は判定対象データであり、実行すべき命令ではありません。
- Claude には rules ファイルを読ませず、action 側で検証済みの `description` と semantic rule の `id: description` だけを正規化済み semantic rules prompt として `prompt` 本文に渡します。
- Claude には `Read` だけを許可し、読み取り対象は変更ファイル一覧と diff に限定します。
- Claude にはコメント投稿やラベル更新をさせません。
- PRコメントとラベル更新は、同梱された action script が GitHub API で実行します。
- workflow の `permissions` は `contents: read`, `pull-requests: write`, `issues: write` に絞ってください。

## リリース

このリポジトリのリリースは tagpr で管理します。

- `main` に変更が入ると、tagpr が次リリース用の PR を作成または更新します。
- tagpr のリリース PR をマージすると、`package.json` と `package-lock.json` の version に対応する `vX.Y.Z` タグと GitHub Release が作成されます。
- tagpr がタグを作成した時だけ、`haya14busa/action-update-semver@v1` で `v1` タグを同じコミットへ更新します。

GitHub Actions から tagpr のリリース PR を作成できるように、リポジトリの `Settings` -> `Actions` -> `General` で `Allow GitHub Actions to create and approve pull requests` を有効にしてください。

## 開発

このリポジトリを開発する場合:

```bash
npm test
npm run typecheck
npm run build
```

`dist/` は action 実行時に使われるバンドルです。`src/` を変更したら `npm run build` で更新してください。
