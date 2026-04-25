import { graphql } from '@octokit/graphql';
import fetch from 'node-fetch';
import { config } from '../config.js';

// GraphQLクライアントの初期化
const graphqlWithAuth = graphql.defaults({
  headers: {
    authorization: `token ${config.github.token}`,
  },
});

export async function getProjectId() {
  try {
    const result = await graphqlWithAuth(`
      query($owner: String!, $number: Int!) {
        user(login: $owner) {
          projectV2(number: $number) {
            id
          }
        }
      }
    `, { owner: config.github.owner, number: config.github.projectNumber });

    if (!result.user?.projectV2) {
      // ユーザーレベルのプロジェクトが見つからない場合、組織レベルのプロジェクトを試す
      const orgResult = await graphqlWithAuth(`
        query($owner: String!, $number: Int!) {
          organization(login: $owner) {
            projectV2(number: $number) {
              id
            }
          }
        }
      `, { owner: config.github.owner, number: config.github.projectNumber });

      if (!orgResult.organization?.projectV2) {
        throw new Error(`プロジェクト番号 ${config.github.projectNumber} がユーザーまたは組織 ${config.github.owner} で見つかりませんでした`);
      }

      return orgResult.organization.projectV2.id;
    }

    return result.user.projectV2.id;
  } catch (error) {
    handleAuthError(error);
    throw error;
  }
}

export async function getProjectItems(projectId) {
  const allItems = [];
  let hasNextPage = true;
  let endCursor = null;

  while (hasNextPage) {
    try {
      const result = await graphqlWithAuth(`
        query($projectId: ID!, $first: Int!, $after: String) {
          node(id: $projectId) {
            ... on ProjectV2 {
              items(first: $first, after: $after) {
                pageInfo {
                  endCursor
                  hasNextPage
                }
                nodes {
                  id
                  type
                  fieldValues(first: 20) {
                    nodes {
                      ... on ProjectV2ItemFieldTextValue {
                        text
                        field { ... on ProjectV2FieldCommon { name } }
                      }
                      ... on ProjectV2ItemFieldDateValue {
                        date
                        field { ... on ProjectV2FieldCommon { name } }
                      }
                      ... on ProjectV2ItemFieldSingleSelectValue {
                        name
                        field { ... on ProjectV2FieldCommon { name } }
                      }
                      ... on ProjectV2ItemFieldNumberValue {
                        number
                        field { ... on ProjectV2FieldCommon { name } }
                      }
                    }
                  }
                  content {
                    ... on Issue {
                      id
                      title
                      body
                      bodyHTML
                      bodyText
                      state
                      number
                      repository { name }
                      labels(first: 10) { nodes { name } }
                      assignees(first: 10) { nodes { login } }
                      author { login }
                      createdAt
                      comments(first: 10) {
                        nodes {
                          body
                          bodyHTML
                          bodyText
                          createdAt
                          author { login }
                        }
                      }
                    }
                    ... on PullRequest {
                      id
                      title
                      body
                      bodyHTML
                      bodyText
                      state
                      number
                      repository { name }
                      labels(first: 10) { nodes { name } }
                      assignees(first: 10) { nodes { login } }
                      author { login }
                      createdAt
                      comments(first: 10) {
                        nodes {
                          body
                          bodyHTML
                          bodyText
                          createdAt
                          author { login }
                        }
                      }
                    }
                  }
                }
              }
            }
          }
        }
      `, { projectId, first: 100, after: endCursor });

      const { nodes, pageInfo } = result.node.items;
      allItems.push(...nodes);
      hasNextPage = pageInfo.hasNextPage;
      endCursor = pageInfo.endCursor;
    } catch (error) {
      console.error('プロジェクトアイテムの取得中にエラーが発生しました:', error);
      throw error;
    }
  }

  return allItems;
}

export async function getIssueDetails(owner, repo, number) {
  try {
    const result = await graphqlWithAuth(`
      query($owner: String!, $repo: String!, $number: Int!) {
        repository(owner: $owner, name: $repo) {
          issueOrPullRequest(number: $number) {
            ... on Issue {
              body
              bodyHTML
              bodyText
              comments(first: 10) {
                nodes {
                  body
                  bodyHTML
                  bodyText
                  author { login }
                  createdAt
                }
              }
            }
            ... on PullRequest {
              body
              bodyHTML
              bodyText
              comments(first: 10) {
                nodes {
                  body
                  bodyHTML
                  bodyText
                  author { login }
                  createdAt
                }
              }
            }
          }
        }
      }
    `, { owner, repo, number });
    return result.repository.issueOrPullRequest;
  } catch (error) {
    console.error(`${repo}#${number} の詳細情報取得中にエラーが発生しました:`, error.message);
    return null;
  }
}

export async function downloadFromGitHub(url) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), config.github.timeout || 10000);

  try {
    const urlObj = new URL(url);
    const headers = {
      'User-Agent': 'GitHub-Project-Cards-Fetcher'
    };

    // Only add Authorization for allowlisted hosts
    if (config.github.allowedHosts?.includes(urlObj.hostname)) {
      headers['Authorization'] = `Bearer ${config.github.token}`;
    }

    const response = await fetch(url, {
      headers,
      signal: controller.signal
    });

    clearTimeout(timeout);

    if (!response.ok) {
      throw new Error(`ダウンロードに失敗しました: ${response.statusText}`);
    }

    return response;
  } catch (error) {
    clearTimeout(timeout);
    if (error.name === 'AbortError') {
      throw new Error(`ダウンロードがタイムアウトしました: ${url}`);
    }
    throw error;
  }
}

// 認証エラーの処理
function handleAuthError(error) {
  if (error != null && typeof error === 'object' && typeof error.message === 'string') {
    if (error.message.includes('Resource not accessible by personal access token')) {
      console.error('\nエラー: GitHubトークンに十分な権限がありません。');
      console.error('以下の権限が必要です:');
      console.error('- リポジトリへのアクセス権限 (repo スコープ)');
      console.error('- プロジェクトへのアクセス権限 (project スコープ)');
      console.error('- 組織の読み取り権限 (read:org スコープ) ※組織のプロジェクトにアクセスする場合');
      console.error('\nトークンは以下のURLで更新できます: https://github.com/settings/tokens');
    }
  }
}