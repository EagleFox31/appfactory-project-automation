import fs from 'node:fs';
import path from 'node:path';
import {
  bootstrapFieldDefinitions,
  isBootstrapEnabled,
  issueMetadata,
  issueStatusForAction,
  mergeSingleSelectOptions,
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

function projectDetailsSelection() {
  return `
    fields(first: 100) {
      nodes {
        __typename
        ... on ProjectV2Field { id name }
        ... on ProjectV2SingleSelectField {
          id
          name
          options { id name color description }
        }
        ... on ProjectV2IterationField { id name }
      }
    }
    views(first: 100) {
      nodes { id name layout }
    }
    repositories(first: 100) {
      nodes { id nameWithOwner }
    }
  `;
}

async function loadProjectContext() {
  const details = projectDetailsSelection();
  const query = `
    query ProjectContext($projectOwner: String!, $repoOwner: String!, $repoName: String!) {
      repositoryOwner(login: $projectOwner) {
        __typename
        id
        login
        ... on User {
          projectsV2(first: 100) {
            nodes { id number title ${details} }
          }
        }
        ... on Organization {
          projectsV2(first: 100) {
            nodes { id number title ${details} }
          }
        }
      }
      repository(owner: $repoOwner, name: $repoName) {
        id
        nameWithOwner
      }
    }
  `;

  const data = await graphql(query, {
    projectOwner: config.project.owner,
    repoOwner: repositoryOwner,
    repoName: repositoryName
  });
  const owner = data.repositoryOwner;
  if (!owner) throw new Error(`GitHub owner "${config.project.owner}" could not be resolved.`);
  if (!data.repository) throw new Error(`Repository "${repositoryFullName}" could not be resolved.`);

  return { owner, repository: data.repository };
}

async function fetchProject(projectId) {
  const details = projectDetailsSelection();
  const query = `
    query ProjectById($projectId: ID!) {
      node(id: $projectId) {
        ... on ProjectV2 {
          id
          number
          title
          ${details}
        }
      }
    }
  `;
  const data = await graphql(query, { projectId });
  if (!data.node?.id) throw new Error('Unable to reload the GitHub Project after mutation.');
  return data.node;
}

async function createProject(owner, repository) {
  const mutation = `
    mutation CreateProject($input: CreateProjectV2Input!) {
      createProjectV2(input: $input) {
        projectV2 { id number title }
      }
    }
  `;
  const input = {
    ownerId: owner.id,
    title: config.project.title
  };
  if (config.project.linkRepository !== false) input.repositoryId = repository.id;

  const data = await graphql(mutation, { input });
  const created = data.createProjectV2?.projectV2;
  if (!created?.id) throw new Error('GitHub did not return the newly created Project id.');

  console.log(`Created ${owner.__typename} Project #${created.number}: ${created.title}`);
  return fetchProject(created.id);
}

async function resolveProject() {
  const context = await loadProjectContext();
  const projects = context.owner.projectsV2?.nodes ?? [];
  const existing = projects.find((candidate) => candidate.title === config.project.title);

  if (existing) {
    console.log(`Resolved ${context.owner.__typename} Project #${existing.number}: ${existing.title}`);
    return { project: existing, created: false, ...context };
  }

  if (!isBootstrapEnabled(config)) {
    const visible = projects.map((candidate) => candidate.title).join(', ') || '(none visible)';
    throw new Error(
      `Project "${config.project.title}" was not found for ${config.project.owner} ` +
      `(${context.owner.__typename}). Visible projects: ${visible}`
    );
  }

  return {
    project: await createProject(context.owner, context.repository),
    created: true,
    ...context
  };
}

async function ensureRepositoryLinked(project, repository) {
  if (config.project.linkRepository === false) return;
  if (project.repositories?.nodes?.some((candidate) => candidate.id === repository.id)) return;

  const mutation = `
    mutation LinkProjectRepository($projectId: ID!, $repositoryId: ID!) {
      linkProjectV2ToRepository(input: { projectId: $projectId, repositoryId: $repositoryId }) {
        repository { id nameWithOwner }
      }
    }
  `;
  await graphql(mutation, { projectId: project.id, repositoryId: repository.id });
  project.repositories ??= { nodes: [] };
  project.repositories.nodes.push(repository);
  console.log(`Linked Project to ${repository.nameWithOwner}`);
}

function findSingleSelectField(project, configuredName) {
  return project.fields.nodes.find(
    (field) => field?.name === configuredName && Array.isArray(field.options)
  );
}

function findFieldByName(project, configuredName) {
  return project.fields.nodes.find((field) => field?.name === configuredName);
}

function freshProjectOptions(existing, desired) {
  return desired.map((entry) => {
    const match = existing.find((candidate) => normalize(candidate.name) === normalize(entry.name));
    return {
      ...(match?.id ? { id: match.id } : {}),
      name: entry.name,
      color: entry.color || match?.color || 'GRAY',
      description: entry.description || match?.description || ''
    };
  });
}

async function createSingleSelectField(project, definition) {
  const mutation = `
    mutation CreateSingleSelectField($input: CreateProjectV2FieldInput!) {
      createProjectV2Field(input: $input) {
        projectV2Field {
          __typename
          ... on ProjectV2SingleSelectField {
            id
            name
            options { id name color description }
          }
        }
      }
    }
  `;
  const data = await graphql(mutation, {
    input: {
      projectId: project.id,
      dataType: 'SINGLE_SELECT',
      name: definition.name,
      singleSelectOptions: definition.options
    }
  });
  const field = data.createProjectV2Field?.projectV2Field;
  if (!field?.id || !Array.isArray(field.options)) {
    throw new Error(`GitHub did not return the created single-select field "${definition.name}".`);
  }
  project.fields.nodes.push(field);
  console.log(`Created Project field: ${definition.name}`);
  return field;
}

async function updateSingleSelectOptions(project, field, desiredOptions, replaceExtras = false) {
  const options = replaceExtras
    ? freshProjectOptions(field.options, desiredOptions)
    : mergeSingleSelectOptions(field.options, desiredOptions);

  const existingNames = field.options.map((entry) => normalize(entry.name));
  const nextNames = options.map((entry) => normalize(entry.name));
  const needsUpdate = replaceExtras
    ? existingNames.join('|') !== nextNames.join('|')
    : nextNames.some((name) => !existingNames.includes(name));

  if (!needsUpdate) return field;

  const mutation = `
    mutation UpdateSingleSelectField($input: UpdateProjectV2FieldInput!) {
      updateProjectV2Field(input: $input) {
        projectV2Field {
          __typename
          ... on ProjectV2SingleSelectField {
            id
            name
            options { id name color description }
          }
        }
      }
    }
  `;
  const data = await graphql(mutation, {
    input: {
      fieldId: field.id,
      singleSelectOptions: options
    }
  });
  const updated = data.updateProjectV2Field?.projectV2Field;
  if (!updated?.id || !Array.isArray(updated.options)) {
    throw new Error(`GitHub did not return the updated single-select field "${field.name}".`);
  }

  const index = project.fields.nodes.findIndex((candidate) => candidate.id === field.id);
  if (index >= 0) project.fields.nodes[index] = updated;
  console.log(`Updated Project field options: ${field.name}`);
  return updated;
}

async function ensureProjectSchema(project, issues = [], { freshProject = false } = {}) {
  const definitions = bootstrapFieldDefinitions(config, issues);
  for (const definition of definitions) {
    const anyField = findFieldByName(project, definition.name);
    if (!anyField) {
      await createSingleSelectField(project, definition);
      continue;
    }

    const field = findSingleSelectField(project, definition.name);
    if (!field) {
      throw new Error(
        `Project field "${definition.name}" exists but is not a single-select field. ` +
        'Bootstrap will not replace it automatically.'
      );
    }

    await updateSingleSelectOptions(project, field, definition.options, freshProject);
  }
  return project;
}

async function ensureBoardView(project) {
  if (config.project.createBoardView === false) return;
  const name = config.bootstrap?.boardViewName || 'AppFactory Board';
  if (project.views?.nodes?.some((view) => normalize(view.name) === normalize(name))) return;

  const mutation = `
    mutation CreateBoardView($input: CreateProjectV2ViewInput!) {
      createProjectV2View(input: $input) {
        projectV2View { id name layout }
      }
    }
  `;
  const data = await graphql(mutation, {
    input: {
      projectId: project.id,
      name,
      layout: 'BOARD_LAYOUT'
    }
  });
  const view = data.createProjectV2View?.projectV2View;
  if (!view?.id) throw new Error('GitHub did not return the newly created board view.');
  project.views ??= { nodes: [] };
  project.views.nodes.push(view);
  console.log(`Created board view: ${view.name}`);
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

async function loadProjectItemMap(projectId) {
  const query = `
    query ProjectItems($projectId: ID!, $after: String) {
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
  const result = new Map();
  let after = null;
  do {
    const data = await graphql(query, { projectId, after });
    const connection = data.node?.items;
    if (!connection) throw new Error('Unable to read Project items during bootstrap.');
    for (const item of connection.nodes) {
      if (item.content?.id) result.set(item.content.id, item.id);
    }
    if (!connection.pageInfo.hasNextPage) break;
    after = connection.pageInfo.endCursor;
  } while (after);
  return result;
}

async function ensureProjectItem(projectId, contentId, itemMap = null) {
  const existingItemId = itemMap?.get(contentId) ?? await findProjectItem(projectId, contentId);
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
  itemMap?.set(contentId, itemId);
  return { itemId, added: true };
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

async function loadOpenIssues() {
  const query = `
    query OpenIssues($owner: String!, $name: String!, $after: String) {
      repository(owner: $owner, name: $name) {
        issues(first: 100, after: $after, states: OPEN, orderBy: { field: CREATED_AT, direction: ASC }) {
          nodes { id number title body state }
          pageInfo { hasNextPage endCursor }
        }
      }
    }
  `;
  const issues = [];
  let after = null;
  do {
    const data = await graphql(query, {
      owner: repositoryOwner,
      name: repositoryName,
      after
    });
    const connection = data.repository?.issues;
    if (!connection) throw new Error(`Unable to enumerate open Issues for ${repositoryFullName}.`);
    issues.push(...connection.nodes);
    if (!connection.pageInfo.hasNextPage) break;
    after = connection.pageInfo.endCursor;
  } while (after);
  return issues;
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

async function importOpenIssues(project, issues) {
  if (!issues.length) {
    console.log('No open Issues to import into the Project backlog.');
    return;
  }

  const itemMap = await loadProjectItemMap(project.id);
  let added = 0;
  for (const issue of issues) {
    const result = await ensureProjectItem(project.id, issue.id, itemMap);
    if (result.added) added += 1;
    await applyIssueFields(project, issue, result.itemId, config.statusTransitions.issueOpened);
  }
  console.log(`Backlog import complete: ${issues.length} open Issues synchronized (${added} newly added).`);
}

async function bootstrapProject(project, repository, { freshProject = false } = {}) {
  const shouldImport = config.project.importOpenIssues !== false;
  const issues = shouldImport ? await loadOpenIssues() : [];

  await ensureRepositoryLinked(project, repository);
  await ensureProjectSchema(project, issues, { freshProject });
  await ensureBoardView(project);
  if (shouldImport) await importOpenIssues(project, issues);

  console.log(`AppFactory bootstrap complete for Project #${project.number}: ${project.title}`);
  return project;
}

async function handleIssueEvent(project) {
  const issue = event.issue;
  if (!issue?.node_id) throw new Error('Issue event does not contain issue.node_id.');

  if (isBootstrapEnabled(config)) await ensureProjectSchema(project, [issue]);
  const { itemId } = await ensureProjectItem(project.id, issue.node_id);
  const status = issueStatusForAction(event.action, config.statusTransitions);
  await applyIssueFields(project, issue, itemId, status);
  console.log(`Synced Issue #${issue.number}: ${issue.title}`);
}

async function handleManualIssue(project) {
  if (!manualIssueNumber) throw new Error('Manual execution requires a positive issue-number input.');

  const issue = await loadIssue(manualIssueNumber);
  if (isBootstrapEnabled(config)) await ensureProjectSchema(project, [issue]);
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

  if (isBootstrapEnabled(config)) await ensureProjectSchema(project, issues);
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

const resolution = await resolveProject();
let project = resolution.project;
let bootstrapAlreadyRan = false;

if (resolution.created) {
  project = await bootstrapProject(project, resolution.repository, { freshProject: true });
  bootstrapAlreadyRan = true;
}

if (eventName === 'workflow_dispatch') {
  if (manualIssueNumber) {
    await handleManualIssue(project);
  } else if (isBootstrapEnabled(config)) {
    if (!bootstrapAlreadyRan) {
      await bootstrapProject(project, resolution.repository, { freshProject: false });
    }
  } else {
    throw new Error('Manual execution requires issue-number unless project.bootstrap is enabled.');
  }
} else if (eventName === 'issues') {
  await handleIssueEvent(project);
} else if (eventName === 'pull_request') {
  await handlePullRequestEvent(project);
} else {
  console.log(`Unsupported event ${rawEventName}; nothing to do.`);
}
