export const APPFACTORY_PRODUCT_TEMPLATE = Object.freeze({
  metadataCommentKey: 'appfactory-project',
  fields: {
    status: 'Status',
    priority: 'Priority',
    workType: 'Work type',
    phase: 'Phase',
    size: 'Size'
  },
  statusTransitions: {
    issueOpened: 'Backlog',
    issueReopened: 'Backlog',
    issueClosed: 'Done',
    draftPullRequest: 'In Progress',
    pullRequestReady: 'Review',
    pullRequestMerged: 'Done'
  },
  workTypeByTitlePrefix: {
    '[Foundation]': 'Engineering',
    '[Engineering]': 'Engineering',
    '[Feature]': 'Feature',
    '[UX]': 'UX',
    '[Security]': 'Security',
    '[Quality]': 'Quality',
    '[Documentation]': 'Documentation',
    '[Product]': 'Product',
    '[Bug]': 'Bug'
  },
  bootstrap: {
    boardViewName: 'AppFactory Board',
    phases: ['Discover', 'Specify', 'Design', 'Build', 'Verify', 'Ship', 'Observe', 'Iterate']
  }
});

const STANDARD_OPTIONS = Object.freeze({
  status: [
    ['Backlog', 'GRAY', 'Captured work that has not been committed to delivery yet.'],
    ['Ready', 'BLUE', 'Ready to be picked up.'],
    ['In Progress', 'YELLOW', 'Actively being implemented.'],
    ['Review', 'PURPLE', 'Implementation is under review.'],
    ['Validation', 'ORANGE', 'Awaiting product or acceptance validation.'],
    ['Done', 'GREEN', 'Completed work.']
  ],
  priority: [
    ['P0', 'RED', 'Critical priority.'],
    ['P1', 'ORANGE', 'High priority.'],
    ['P2', 'YELLOW', 'Normal priority.'],
    ['P3', 'BLUE', 'Low priority.']
  ],
  workType: [
    ['Product', 'PURPLE', 'Product discovery, decisions or scope.'],
    ['Feature', 'BLUE', 'User-facing product capability.'],
    ['Engineering', 'GREEN', 'Architecture, platform or engineering work.'],
    ['UX', 'PINK', 'User experience or interface work.'],
    ['Security', 'RED', 'Security or trust-boundary work.'],
    ['Quality', 'YELLOW', 'Testing, reliability or quality work.'],
    ['Documentation', 'GRAY', 'Documentation work.'],
    ['Bug', 'ORANGE', 'Defect correction.']
  ],
  size: [
    ['XS', 'GRAY', 'Very small change.'],
    ['S', 'BLUE', 'Small change.'],
    ['M', 'YELLOW', 'Medium change.'],
    ['L', 'ORANGE', 'Large change.'],
    ['XL', 'RED', 'Very large change; consider splitting.']
  ]
});

const PHASE_COLORS = ['BLUE', 'PURPLE', 'YELLOW', 'ORANGE', 'GREEN', 'PINK', 'GRAY', 'RED'];

export function normalize(value) {
  return String(value ?? '').trim().toLowerCase();
}

function compactUnique(values = []) {
  const result = [];
  const seen = new Set();
  for (const raw of values) {
    const value = String(raw ?? '').trim();
    if (!value) continue;
    const key = normalize(value);
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(value);
  }
  return result;
}

export function parseIssueNumber(raw) {
  const value = String(raw ?? '').trim();
  if (!value) return null;

  const match = value.match(/^(?:issue_number\s*=\s*)?#?([1-9]\d*)$/i);
  if (!match) {
    throw new Error(`Invalid issue number input: "${value}". Use 15, #15, or issue_number = 15.`);
  }

  const number = Number(match[1]);
  if (!Number.isSafeInteger(number) || number <= 0) {
    throw new Error(`Issue number must be a positive safe integer, got: "${value}".`);
  }

  return number;
}

export function parseProjectMetadata(body = '', marker = 'appfactory-project') {
  const escapedMarker = String(marker).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const regex = new RegExp(`<!--\\s*${escapedMarker}\\s*([\\s\\S]*?)-->`, 'i');
  const match = String(body ?? '').match(regex);
  if (!match) return {};

  const metadata = {};
  for (const rawLine of match[1].split('\n')) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;

    const separator = line.indexOf(':');
    if (separator < 1) continue;

    const key = line.slice(0, separator).trim();
    const value = line.slice(separator + 1).trim();
    if (['priority', 'workType', 'phase', 'size'].includes(key) && value) {
      metadata[key] = value;
    }
  }

  return metadata;
}

export function inferWorkType(title = '', mappings = {}) {
  for (const [prefix, workType] of Object.entries(mappings ?? {})) {
    if (String(title).startsWith(prefix)) return workType;
  }
  return undefined;
}

export function issueMetadata(issue, config) {
  const inferred = {
    workType: inferWorkType(issue.title, config.workTypeByTitlePrefix)
  };
  const override = config.issueOverrides?.[String(issue.number)] ?? {};
  const embedded = parseProjectMetadata(
    issue.body ?? '',
    config.metadataCommentKey ?? 'appfactory-project'
  );

  return Object.fromEntries(
    Object.entries({ ...inferred, ...override, ...embedded })
      .filter(([, value]) => value !== undefined && value !== null && value !== '')
  );
}

export function issueStatusForAction(action, transitions = {}) {
  switch (action) {
    case 'opened': return transitions.issueOpened;
    case 'reopened': return transitions.issueReopened;
    case 'closed': return transitions.issueClosed;
    default: return undefined;
  }
}

export function pullRequestTargetStatus({ action, merged, draft }, transitions = {}) {
  if (action === 'closed' && merged) return transitions.pullRequestMerged;
  if (['opened', 'reopened'].includes(action) && draft) return transitions.draftPullRequest;
  if (['opened', 'reopened', 'ready_for_review'].includes(action)) return transitions.pullRequestReady;
  return undefined;
}

export function isBootstrapEnabled(config) {
  return config?.project?.bootstrap === true;
}

function templateFor(name) {
  if (!name) return null;
  if (name === 'appfactory-product') return APPFACTORY_PRODUCT_TEMPLATE;
  throw new Error(`Unknown project template: "${name}".`);
}

export function validateConfig(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw new Error('Project config must be a JSON object.');
  }
  if (!input.project?.owner) throw new Error('project.owner is required.');
  if (!input.project?.title) throw new Error('project.title is required.');
  if (input.project.bootstrap !== undefined && typeof input.project.bootstrap !== 'boolean') {
    throw new Error('project.bootstrap must be a boolean when provided.');
  }

  const template = templateFor(input.project.template);
  const config = template
    ? {
        ...template,
        ...input,
        project: {
          linkRepository: true,
          importOpenIssues: true,
          createBoardView: true,
          ...input.project
        },
        fields: { ...template.fields, ...(input.fields ?? {}) },
        statusTransitions: { ...template.statusTransitions, ...(input.statusTransitions ?? {}) },
        workTypeByTitlePrefix: {
          ...template.workTypeByTitlePrefix,
          ...(input.workTypeByTitlePrefix ?? {})
        },
        bootstrap: { ...template.bootstrap, ...(input.bootstrap ?? {}) },
        issueOverrides: input.issueOverrides ?? {}
      }
    : {
        ...input,
        project: { ...input.project },
        issueOverrides: input.issueOverrides ?? {}
      };

  if (!config.fields?.status) throw new Error('fields.status is required.');
  if (!config.statusTransitions?.issueOpened) throw new Error('statusTransitions.issueOpened is required.');
  if (!config.statusTransitions?.issueClosed) throw new Error('statusTransitions.issueClosed is required.');

  if (isBootstrapEnabled(config)) {
    if (config.project.template !== 'appfactory-product') {
      throw new Error('Bootstrap currently requires project.template="appfactory-product".');
    }
    if (!Array.isArray(config.bootstrap?.phases)) {
      throw new Error('bootstrap.phases must be an array when bootstrap is enabled.');
    }
  }

  return config;
}

function option(name, color = 'GRAY', description = '') {
  return { name, color, description };
}

function metadataValues(config, issues, key) {
  const values = [];
  for (const override of Object.values(config.issueOverrides ?? {})) {
    if (override?.[key]) values.push(override[key]);
  }
  for (const issue of issues ?? []) {
    const metadata = issueMetadata(issue, config);
    if (metadata[key]) values.push(metadata[key]);
  }
  return compactUnique(values);
}

function optionsWithExtras(baseRows, extras, defaultColor = 'GRAY') {
  const base = baseRows.map(([name, color, description]) => option(name, color, description));
  const known = new Set(base.map((entry) => normalize(entry.name)));
  for (const name of compactUnique(extras)) {
    if (known.has(normalize(name))) continue;
    base.push(option(name, defaultColor, 'Repository-specific option discovered by AppFactory bootstrap.'));
    known.add(normalize(name));
  }
  return base;
}

export function bootstrapFieldDefinitions(config, issues = []) {
  const statusExtras = Object.values(config.statusTransitions ?? {});
  const priorityExtras = metadataValues(config, issues, 'priority');
  const workTypeExtras = [
    ...Object.values(config.workTypeByTitlePrefix ?? {}),
    ...metadataValues(config, issues, 'workType')
  ];
  const sizeExtras = metadataValues(config, issues, 'size');
  const phaseNames = compactUnique([
    ...(config.bootstrap?.phases ?? []),
    ...metadataValues(config, issues, 'phase')
  ]);

  const phaseOptions = phaseNames.map((name, index) => option(
    name,
    PHASE_COLORS[index % PHASE_COLORS.length],
    'Product delivery phase.'
  ));

  const definitions = [
    {
      key: 'status',
      name: config.fields.status,
      options: optionsWithExtras(STANDARD_OPTIONS.status, statusExtras)
    }
  ];

  if (config.fields.priority) {
    definitions.push({
      key: 'priority',
      name: config.fields.priority,
      options: optionsWithExtras(STANDARD_OPTIONS.priority, priorityExtras)
    });
  }
  if (config.fields.workType) {
    definitions.push({
      key: 'workType',
      name: config.fields.workType,
      options: optionsWithExtras(STANDARD_OPTIONS.workType, workTypeExtras)
    });
  }
  if (config.fields.phase) {
    definitions.push({
      key: 'phase',
      name: config.fields.phase,
      options: phaseOptions.length ? phaseOptions : [option('Foundation', 'BLUE', 'Initial product foundation.')]
    });
  }
  if (config.fields.size) {
    definitions.push({
      key: 'size',
      name: config.fields.size,
      options: optionsWithExtras(STANDARD_OPTIONS.size, sizeExtras)
    });
  }

  for (const definition of definitions) {
    if (definition.options.length > 50) {
      throw new Error(`Project field "${definition.name}" would exceed GitHub's 50-option single-select limit.`);
    }
  }

  return definitions;
}

export function mergeSingleSelectOptions(existing = [], desired = []) {
  const merged = existing.map((entry) => ({
    ...(entry.id ? { id: entry.id } : {}),
    name: entry.name,
    color: entry.color || 'GRAY',
    description: entry.description || ''
  }));
  const seen = new Set(merged.map((entry) => normalize(entry.name)));

  for (const entry of desired) {
    if (seen.has(normalize(entry.name))) continue;
    merged.push({
      name: entry.name,
      color: entry.color || 'GRAY',
      description: entry.description || ''
    });
    seen.add(normalize(entry.name));
  }

  if (merged.length > 50) {
    throw new Error("A GitHub Projects single-select field cannot contain more than 50 options.");
  }

  return merged;
}
