import { graphql } from '@octokit/graphql';
import fetch from 'node-fetch';
import { config } from '../config.js';

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
    `, {
      owner: config.github.owner,
      number: config.github.projectNumber
    });

    if (!result.user?.projectV2) {
      // Try organization-level project
      const orgResult = await graphqlWithAuth(`
        query($owner: String!, $number: Int!) {
          organization(login: $owner) {
            projectV2(number: $number) {
              id
            }
          }
        }
      `, {
        owner: config.github.owner,
        number: config.github.projectNumber
      });

      if (!orgResult.organization?.projectV2) {
        throw new Error(`Project number ${config.github.projectNumber} not found for user or organization ${config.github.owner}`);
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
  try {
    const result = await graphqlWithAuth(`
      query($projectId: ID!, $first: Int!) {
        node(id: $projectId) {
          ... on ProjectV2 {
            items(first: $first) {
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
    `, {
      projectId,
      first: 100
    });

    return result.node.items.nodes;
  } catch (error) {
    console.error('Error fetching project items:', error);
    throw error;
  }
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
    `, {
      owner,
      repo,
      number
    });
    return result.repository.issueOrPullRequest;
  } catch (error) {
    console.error(`Error fetching details for ${repo}#${number}:`, error.message);
    return null;
  }
}

export async function downloadFromGitHub(url) {
  const response = await fetch(url, {
    headers: {
      'User-Agent': 'GitHub-Project-Cards-Fetcher',
      'Authorization': `Bearer ${config.github.token}`
    }
  });

  if (!response.ok) {
    throw new Error(`Failed to download: ${response.statusText}`);
  }

  return response;
}

function handleAuthError(error) {
  if (error.message.includes('Resource not accessible by personal access token')) {
    console.error('\nError: The GitHub token does not have sufficient permissions.');
    console.error('Please make sure your token has the following permissions:');
    console.error('- repo scope (for repository access)');
    console.error('- project scope (for project access)');
    console.error('- read:org scope (if accessing organization projects)');
    console.error('\nYou can update your token at: https://github.com/settings/tokens');
  }
}