export function normalize(value) {
  return String(value ?? '').trim().toLowerCase();
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

export function validateConfig(config) {
  if (!config || typeof config !== 'object') throw new Error('Project config must be a JSON object.');
  if (!config.project?.owner) throw new Error('project.owner is required.');
  if (!config.project?.title) throw new Error('project.title is required.');
  if (!config.fields?.status) throw new Error('fields.status is required.');
  if (!config.statusTransitions?.issueOpened) throw new Error('statusTransitions.issueOpened is required.');
  if (!config.statusTransitions?.issueClosed) throw new Error('statusTransitions.issueClosed is required.');
  return config;
}
