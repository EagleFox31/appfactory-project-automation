import test from 'node:test';
import assert from 'node:assert/strict';
import {
  bootstrapFieldDefinitions,
  inferWorkType,
  isBootstrapEnabled,
  issueMetadata,
  mergeSingleSelectOptions,
  parseIssueNumber,
  parseProjectMetadata,
  pullRequestTargetStatus,
  validateConfig
} from '../src/lib.mjs';

test('parseIssueNumber accepts supported manual forms', () => {
  assert.equal(parseIssueNumber('15'), 15);
  assert.equal(parseIssueNumber('#15'), 15);
  assert.equal(parseIssueNumber('issue_number = 15'), 15);
  assert.equal(parseIssueNumber('  #42  '), 42);
});

test('parseIssueNumber rejects ambiguous and invalid values', () => {
  assert.throws(() => parseIssueNumber('issue 15'), /Invalid issue number/);
  assert.throws(() => parseIssueNumber('0'), /Invalid issue number/);
  assert.throws(() => parseIssueNumber('-2'), /Invalid issue number/);
  assert.equal(parseIssueNumber(''), null);
});

test('parseProjectMetadata uses a configurable marker', () => {
  const body = `Text\n<!-- appfactory-project\npriority: P1\nworkType: Security\nphase: Foundation\nsize: L\n-->`;
  assert.deepEqual(parseProjectMetadata(body), {
    priority: 'P1',
    workType: 'Security',
    phase: 'Foundation',
    size: 'L'
  });
});

test('legacy marker can be retained per consuming repository', () => {
  const body = '<!-- agenstart-project\npriority: P0\n-->';
  assert.deepEqual(parseProjectMetadata(body, 'agenstart-project'), { priority: 'P0' });
});

test('metadata precedence is inferred < override < embedded metadata', () => {
  const config = {
    metadataCommentKey: 'appfactory-project',
    workTypeByTitlePrefix: { '[Security]': 'Security' },
    issueOverrides: {
      '11': { priority: 'P1', workType: 'Engineering', phase: 'Foundation', size: 'M' }
    }
  };
  const issue = {
    number: 11,
    title: '[Security] Example',
    body: '<!-- appfactory-project\npriority: P0\nworkType: Security\nsize: L\n-->'
  };
  assert.deepEqual(issueMetadata(issue, config), {
    workType: 'Security',
    priority: 'P0',
    phase: 'Foundation',
    size: 'L'
  });
});

test('inferWorkType maps title prefixes', () => {
  assert.equal(inferWorkType('[Feature] Add export', { '[Feature]': 'Feature' }), 'Feature');
  assert.equal(inferWorkType('Add export', { '[Feature]': 'Feature' }), undefined);
});

test('pull request lifecycle resolves expected statuses', () => {
  const transitions = {
    draftPullRequest: 'In Progress',
    pullRequestReady: 'Review',
    pullRequestMerged: 'Done'
  };
  assert.equal(pullRequestTargetStatus({ action: 'opened', draft: true }, transitions), 'In Progress');
  assert.equal(pullRequestTargetStatus({ action: 'ready_for_review', draft: false }, transitions), 'Review');
  assert.equal(pullRequestTargetStatus({ action: 'closed', merged: true, draft: false }, transitions), 'Done');
  assert.equal(pullRequestTargetStatus({ action: 'closed', merged: false, draft: false }, transitions), undefined);
});

test('validateConfig keeps legacy explicit configs working', () => {
  assert.throws(() => validateConfig({}), /project.owner/);
  assert.doesNotThrow(() => validateConfig({
    project: { owner: 'EagleFox31', title: 'Example' },
    fields: { status: 'Status' },
    statusTransitions: { issueOpened: 'Backlog', issueClosed: 'Done' }
  }));
});

test('appfactory-product template hydrates a minimal bootstrap config', () => {
  const config = validateConfig({
    project: {
      owner: 'EagleFox31',
      title: 'Example Product Development',
      bootstrap: true,
      template: 'appfactory-product'
    },
    bootstrap: { phases: ['Foundation', 'Release'] }
  });

  assert.equal(isBootstrapEnabled(config), true);
  assert.equal(config.fields.priority, 'Priority');
  assert.equal(config.statusTransitions.issueOpened, 'Backlog');
  assert.equal(config.project.importOpenIssues, true);
  assert.deepEqual(config.bootstrap.phases, ['Foundation', 'Release']);
});

test('bootstrap definitions discover repository-specific metadata options', () => {
  const config = validateConfig({
    project: {
      owner: 'EagleFox31',
      title: 'Example',
      bootstrap: true,
      template: 'appfactory-product'
    },
    bootstrap: { phases: ['Foundation'] },
    issueOverrides: {
      '8': { priority: 'P1', workType: 'UX', phase: 'Desktop MVP', size: 'XL' }
    }
  });

  const definitions = bootstrapFieldDefinitions(config, [{
    number: 9,
    title: '[Feature] Export',
    body: '<!-- appfactory-project\nphase: Reproducible Setup\n-->'
  }]);
  const phase = definitions.find((field) => field.key === 'phase');

  assert.deepEqual(phase.options.map((entry) => entry.name), [
    'Foundation',
    'Desktop MVP',
    'Reproducible Setup'
  ]);
});

test('mergeSingleSelectOptions preserves existing option ids and only adds missing options', () => {
  const merged = mergeSingleSelectOptions(
    [{ id: 'opt_1', name: 'Backlog', color: 'GRAY', description: 'Existing' }],
    [
      { name: 'Backlog', color: 'BLUE', description: 'Desired' },
      { name: 'Ready', color: 'BLUE', description: 'Ready' }
    ]
  );

  assert.deepEqual(merged, [
    { id: 'opt_1', name: 'Backlog', color: 'GRAY', description: 'Existing' },
    { name: 'Ready', color: 'BLUE', description: 'Ready' }
  ]);
});
