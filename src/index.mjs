import fs from 'node:fs';
import path from 'node:path';
import {
  issueMetadata,
  issueStatusForAction,
  normalize,
  parseIssueNumber,
  pullRequestTargetStatus,
  validateConfig
} from './lib.mjs';

const token = process.env.INPUT_TOKEN || process.env.PROJECT_TOKEN;
const configPath = path.resolve(process.env.INPUT_CONFIG_PATH || '.github/project-config.json');
const manualIssueNumber = parseIssueNumber(process.env.INPUT_ISSUE_NUMBER || process.env.MANUAL_ISSUE_NUMBER);
const repositoryFullName = process.env.GITHUB_REPOSITORY;
const rawEventName = process.env.GITHUB_EVENT_NAME;
const eventName = rawEventName === 'pull_request_target' ? 'pull_request' : rawEventName;
const eventPath = process.env.GITHUB_EVENT_PATH;

if (!token) throw new Error('A project-capable GitHub token is required through input "token".');
if (!repositoryFullName) throw new Error('GITHUB_REPOSITORY is not available.');
if (!fs.existsSync(configPath)) throw new Error(`Project config not found: ${configPath}`);

const config = validateConfig(JSON.parse(fs.readFileSync(configPath, 'utf8')));
const event = eventPath && fs.existsSync(eventPath)
  ? JSON.parse(fs.readFileSync(eventPath, 'utf8'))
  : {};
const [repositoryOwner, repositoryName] = repositoryFullName.split('/');

async function graphql(query, variables = {}) {
  const response = await fetch('https://api.github.com/graphql', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      'User-Agent': 'AppFactory-Project-Automation'
    },
    body: JSON.stringify({ query, variables })
  });

  if (!response.ok) {
    throw new Error(`GitHub GraphQL HTTP ${response.status}: ${response.statusText}`);
  }

  const payload = await response.json();
  if (payload.errors?.length) {
    const messages = payload.errors.map((error) => error.message).join(' | ');
    throw new Error(`GitHub GraphQL error: ${messages}`);
  }

  return payload.data;
}

function projectFieldsSelection() {
  return `
    fields(first: 100) {
      nodes {
        __typename
        ... on ProjectV2Field { id name }
        ... on ProjectV2SingleSelectField {
          id
          name
          options { id name }
        }
        ... on ProjectV2IterationField { id name }
      }
    }
  `;
}

async function findProject() {
  const fieldsSelection = projectFieldsSelection();
  const query = `
    query ProjectByOwner($login: String!) {
      repositoryOwner(login: $login) {
        __typename
        login
        ... on User {
          projectsV2(first: 100) {
            nodes { id number title ${fieldsSelection} }
          }
        }
        ... on Organization {
          projectsV2(first: 100) {
            nodes { id number title ${fieldsSelection} }
          }
        }
      }
    }
  `;

  const data = await graphql(query, { login: config.project.owner });
  const owner = data.repositoryOwner;
  if (!owner) throw new Error(`GitHub owner "${config.project.owner}" could not be resolved.`);

  const projects = owner.projectsV2?.nodes ?? [];
  const project = projects.find((candidate) => candidate.title === config.project.title);
  if (!project) {
    const visible = projects.map((candidate) => candidate.title).join(', ') || '(none visible)';
    throw new Error(
      `Project "${config.project.title}" was not found for ${config.project.owner} ` +
      `(${owner.__typename}). Visible projects: ${visible}`
    );
  }

  console.log(`Resolved ${owner.__typename} Project #${project.number}: ${project.title}`);
  return project;
}

async function findProjectItem(projectId, contentId) {
  const query = `
    query FindProjectItem($projectId: ID!, $after: String) {
      node(id: $projectId) {
        ... on ProjectV2 {
          items(first: 100, after: $after) {
            nodes {
              id
              content {
                ... on Issue { id }
                ... on PullRequest { id }
              }
            }
            pageInfo { hasNextPage endCursor }
          }
        }
      }
    }
  `;

  let after = null;
  do {
    const data = await graphql(query, { projectId, after });
    const connection = data.node?.items;
    if (!connection) {
      throw new Error('Unable to read Project items. Check token project permissions.');
    }

    const match = connection.nodes.find((item) => item.content?.id === contentId);
    if (match) return match.id;
    if (!connection.pageInfo.hasNextPage) break;
    after = connection.pageInfo.endCursor;
  } while (after);

  return null;
}

async function ensureProjectItem(projectId, contentId) {
  const existingItemId = await findProjectItem(projectId, contentId);
  if (existingItemId) return { itemId: existingItemId, added: false };

  const mutation = `
    mutation AddProjectItem($projectId: ID!, $contentId: ID!) {
      addProjectV2ItemById(input: { projectId: $projectId, contentId: $contentId }) {
        item { id }
      }
    }
  `;

  const data = await graphql(mutation, { projectId, contentId });
  const itemId = data.addProjectV2ItemById?.item?.id;
  if (!itemId) throw new Error('GitHub did not return the newly added Project item id.');
  return { itemId, added: true };
}

function findSingleSelectField(project, configuredName) {
  return project.fields.nodes.find(
    (field) => field?.name === configuredName && Array.isArray(field.options)
  );
}

async function setSingleSelect(project, itemId, configuredFieldName, optionName) {
  if (!configuredFieldName || !optionName) return;

  const field = findSingleSelectField(project, configuredFieldName);
  if (!field) {
    console.warn(`Skipping missing/non-single-select Project field: ${configuredFieldName}`);
    return;
  }

  const option = field.options.find((candidate) => normalize(candidate.name) === normalize(optionName));
  if (!option) {
    console.warn(
      `Skipping ${configuredFieldName}="${optionName}" because that option does not exist. ` +
      `Available: ${field.options.map((candidate) => candidate.name).join(', ')}`
    );
    return;
  }

  const mutation = `
    mutation SetProjectField($projectId: ID!, $itemId: ID!, $fieldId: ID!, $optionId: String!) {
      updateProjectV2ItemFieldValue(
        input: {
          projectId: $projectId,
          itemId: $itemId,
          fieldId: $fieldId,
          value: { singleSelectOptionId: $optionId }
        }
      ) { projectV2Item { id } }
    }
  `;

  await graphql(mutation, {
    projectId: project.id,
    itemId,
    fieldId: field.id,
    optionId: option.id
  });
  console.log(`Set ${configuredFieldName} → ${option.name}`);
}

async function applyIssueFields(project, issue, itemId, status) {
  const metadata = issueMetadata(issue, config);
  await setSingleSelect(project, itemId, config.fields.status, status);
  await setSingleSelect(project, itemId, config.fields.priority, metadata.priority);
  await setSingleSelect(project, itemId, config.fields.workType, metadata.workType);
  await setSingleSelect(project, itemId, config.fields.phase, metadata.phase);
  await setSingleSelect(project, itemId, config.fields.size, metadata.size);
}

async function loadIssue(number) {
  const query = `
    query RepositoryIssue($owner: String!, $name: String!, $number: Int!) {
      repository(owner: $owner, name: $name) {
        issue(number: $number) { id number title body state }
      }
    }
  `;

  const data = await graphql(query, {
    owner: repositoryOwner,
    name: repositoryName,
    number
  });
  const issue = data.repository?.issue;
  if (!issue) throw new Error(`Issue #${number} was not found in ${repositoryFullName}.`);
  return issue;
}

async function closingIssuesForPullRequest(pullRequestId) {
  const query = `
    query PullRequestClosingIssues($id: ID!) {
      node(id: $id) {
        ... on PullRequest {
          closingIssuesReferences(first: 50) {
            nodes {
              id number title body state
              repository { nameWithOwner }
            }
          }
        }
      }
    }
  `;

  const data = await graphql(query, { id: pullRequestId });
  return (data.node?.closingIssuesReferences?.nodes ?? [])
    .filter((issue) => issue.repository?.nameWithOwner === repositoryFullName);
}

async function handleIssueEvent(project) {
  const issue = event.issue;
  if (!issue?.node_id) throw new Error('Issue event does not contain issue.node_id.');

  const { itemId } = await ensureProjectItem(project.id, issue.node_id);
  const status = issueStatusForAction(event.action, config.statusTransitions);
  await applyIssueFields(project, issue, itemId, status);
  console.log(`Synced Issue #${issue.number}: ${issue.title}`);
}

async function handleManualIssue(project) {
  if (!manualIssueNumber) throw new Error('Manual execution requires a positive issue-number input.');

  const issue = await loadIssue(manualIssueNumber);
  const { itemId } = await ensureProjectItem(project.id, issue.id);
  const status = issue.state === 'CLOSED'
    ? config.statusTransitions.issueClosed
    : config.statusTransitions.issueOpened;

  await applyIssueFields(project, issue, itemId, status);
  console.log(`Manually synced Issue #${issue.number}: ${issue.title}`);
}

async function handlePullRequestEvent(project) {
  const pullRequest = event.pull_request;
  if (!pullRequest?.node_id) throw new Error('Pull request event does not contain pull_request.node_id.');

  const issues = await closingIssuesForPullRequest(pullRequest.node_id);
  if (!issues.length) {
    console.log('No linked closing issues found for this pull request. Nothing to update.');
    return;
  }

  const targetStatus = pullRequestTargetStatus(
    { action: event.action, merged: pullRequest.merged, draft: pullRequest.draft },
    config.statusTransitions
  );

  if (!targetStatus) {
    console.log(`No status transition configured for PR action ${event.action}.`);
    return;
  }

  for (const issue of issues) {
    const { itemId } = await ensureProjectItem(project.id, issue.id);
    await applyIssueFields(project, issue, itemId, targetStatus);
    console.log(`PR lifecycle moved Issue #${issue.number} → ${targetStatus}`);
  }
}

const project = await findProject();

if (eventName === 'workflow_dispatch') {
  await handleManualIssue(project);
} else if (eventName === 'issues') {
  await handleIssueEvent(project);
} else if (eventName === 'pull_request') {
  await handlePullRequestEvent(project);
} else {
  console.log(`Unsupported event ${rawEventName}; nothing to do.`);
}
