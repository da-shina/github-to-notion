# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

GitHub Project → Notion のデータを移行するツール。GitHub ProjectV2 の Issue/PR を取得し、Notion データベースにインポートする。

## Commands

```bash
npm install          # 依存関係のインストール
node export-from-github.js   # GitHubからデータをエクスポート（プロジェクトデータ + 添付ファイル）
node import-to-notion.js     # Notionへデータをインポート
```

## Architecture

```
├── config.js              # 設定管理（.env から読み込み）
├── export-from-github.js  # GitHub→ダウンロード: Project Item取得 + 添付ファイルDL
├── import-to-notion.js    # Notionインポート: JSON読取 + ページ作成 + ファイルUpload
├── utils/
│   ├── github-api.js      # GitHub GraphQL API (Octokit) + 添付ファイルDL
│   ├── file-utils.js      # ファイル操作ユーティリティ
│   └── interactive-utils.js # 対話的 продолжение プロンプト
└── downloads/             # 添付ファイルのダウンロード先
```

### Data Flow

1. `export-from-github.js` → GitHub GraphQL API で ProjectV2 のアイテムを取得 → `project_items_data.json` に出力 + 添付ファイルを `downloads/` に保存
2. `import-to-notion.js` → `project_items_data.json` を読み込み → Notion ページにアイテム作成 + ファイルアップロード

### 環境変数 (.env)

```
GITHUB_TOKEN          # GitHub Personal Access Token
GITHUB_OWNER          # ユーザー or 組織名
GITHUB_REPO           # リポジトリ名（任意）
PROJECT_NUMBER        # Project番号
NOTION_TOKEN          # Notion Integration Token
NOTION_DATABASE_ID    # インポート先Notion DB ID
MAX_CONCURRENT_REQUESTS # 同時リクエスト数（デフォルト5）
```

### Key Implementation Details

- ES Modules (`"type": "module"`) で記述
- GitHub GraphQL API: `getProjectId` → `getProjectItems` → `getIssueDetails` の順で取得
- 添付ファイル: `extractAttachments()` で Markdown/HTML からURL抽出 → `downloadAttachments()` でDL
- NotionファイルUpload: 2段階（署名付きURL取得 → S3直接アップロード）
- レートリミット対策: `processInBatches()` でバッチ処理 + 1秒間隔

## Recent Commits

- `e51858e` Merge origin/main into fix/mime-types-and-upload-url
- `0f2271f` fix: address CodeRabbit review feedback
- `16638b3` fix: add missing mime-types dependency and correct Notion API response key