import test from 'node:test';
import assert from 'node:assert/strict';
import {
  inferWorkType,
  issueMetadata,
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

test('validateConfig fails fast for missing core fields', () => {
  assert.throws(() => validateConfig({}), /project.owner/);
  assert.doesNotThrow(() => validateConfig({
    project: { owner: 'EagleFox31', title: 'Example' },
    fields: { status: 'Status' },
    statusTransitions: { issueOpened: 'Backlog', issueClosed: 'Done' }
  }));
});
