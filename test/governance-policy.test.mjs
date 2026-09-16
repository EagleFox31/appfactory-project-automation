import test from 'node:test';
import assert from 'node:assert/strict';
import {
  DEFAULT_BRANCH_REF,
  GOVERNANCE_POLICY_VERSION,
  normalizeGovernanceConfig
} from '../src/governance/policy.mjs';
import { validateConfig } from '../src/lib.mjs';

test('legacy configs normalize governance to a disabled no-op', () => {
  const config = validateConfig({
    project: { owner: 'example-owner', title: 'Example' },
    fields: { status: 'Status' },
    statusTransitions: { issueOpened: 'Backlog', issueClosed: 'Done' }
  });

  assert.deepEqual(config.repository.governance, { enabled: false });
});

test('solo preset produces a deterministic default-branch policy', () => {
  const input = { enabled: true, preset: 'solo' };
  const first = normalizeGovernanceConfig(input);
  const second = normalizeGovernanceConfig(input);

  assert.deepEqual(first, second);
  assert.deepEqual(first, {
    enabled: true,
    policyVersion: GOVERNANCE_POLICY_VERSION,
    preset: 'solo',
    rulesetName: 'AppFactory default branch governance',
    enforcement: 'active',
    target: {
      type: 'branch',
      include: [DEFAULT_BRANCH_REF],
      exclude: []
    },
    preventDeletion: true,
    preventForcePush: true,
    pullRequest: {
      required: true,
      requiredApprovingReviewCount: 0,
      dismissStaleReviewsOnPush: false,
      requireCodeOwnerReview: false,
      requireLastPushApproval: false,
      requiredReviewThreadResolution: true
    },
    requiredStatusChecks: []
  });
});

test('expert overrides refine solo without copying the policy', () => {
  const policy = normalizeGovernanceConfig({
    enabled: true,
    preset: 'solo',
    rulesetName: 'Product default branch',
    pullRequest: {
      requiredApprovingReviewCount: 1,
      dismissStaleReviewsOnPush: true
    },
    requiredStatusChecks: ['test', ' build ', 'test']
  });

  assert.equal(policy.rulesetName, 'Product default branch');
  assert.equal(policy.pullRequest.required, true);
  assert.equal(policy.pullRequest.requiredApprovingReviewCount, 1);
  assert.equal(policy.pullRequest.dismissStaleReviewsOnPush, true);
  assert.deepEqual(policy.requiredStatusChecks, ['build', 'test']);
  assert.deepEqual(policy.target.include, [DEFAULT_BRANCH_REF]);
});

test('disabled governance remains a no-op but still rejects malformed dormant policy', () => {
  assert.deepEqual(normalizeGovernanceConfig({
    enabled: false,
    preset: 'solo',
    requiredStatusChecks: []
  }), { enabled: false });
  assert.throws(
    () => normalizeGovernanceConfig({ enabled: false, preset: 'future-preset' }),
    /Unknown repository governance preset/
  );
});

test('governance validation rejects unknown and unsafe values', () => {
  assert.throws(
    () => normalizeGovernanceConfig({ enabled: true, preset: 'enterprise' }),
    /Unknown repository governance preset/
  );
  assert.throws(
    () => normalizeGovernanceConfig({ enabled: true, branch: 'main' }),
    /repository\.governance\.branch is not supported/
  );
  assert.throws(
    () => normalizeGovernanceConfig({
      enabled: true,
      pullRequest: { requiredApprovingReviewCount: 7 }
    }),
    /integer from 0 to 6/
  );
  assert.throws(
    () => normalizeGovernanceConfig({ enabled: true, requiredStatusChecks: [''] }),
    /cannot be empty/
  );
  assert.throws(
    () => normalizeGovernanceConfig({
      enabled: true,
      pullRequest: { bypassForOwner: true }
    }),
    /bypassForOwner is not supported/
  );
});

test('normalizing a normalized enabled policy is idempotent', () => {
  const normalized = normalizeGovernanceConfig({ enabled: true, preset: 'solo' });
  assert.deepEqual(normalizeGovernanceConfig(normalized), normalized);
});
