import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeGovernanceConfig } from '../src/governance/policy.mjs';
import {
  canonicalRuleset,
  findManagedRuleset,
  rulesetPayloadFromPolicy,
  rulesetsEquivalent
} from '../src/governance/ruleset.mjs';
import { reconcileRepositoryRuleset } from '../src/governance/reconcile.mjs';

const REPOSITORY = 'octo-org/product';

function soloPolicy(overrides = {}) {
  return normalizeGovernanceConfig({ enabled: true, preset: 'solo', ...overrides });
}

function inMemoryClient(initialRulesets = [], { loseFirstCreateResponse = false } = {}) {
  const state = initialRulesets.map((entry) => structuredClone(entry));
  const writes = [];
  let nextId = Math.max(0, ...state.map((entry) => entry.id ?? 0)) + 1;
  let shouldLoseCreateResponse = loseFirstCreateResponse;

  return {
    state,
    writes,
    async listRepositoryRulesets() {
      return state.map(({ id, name, source_type, source, enforcement }) => ({
        id,
        name,
        source_type,
        source,
        enforcement
      }));
    },
    async getRepositoryRuleset(_repository, rulesetId) {
      return structuredClone(state.find((entry) => entry.id === rulesetId));
    },
    async createRepositoryRuleset(repository, payload) {
      const created = {
        id: nextId++,
        source_type: 'Repository',
        source: repository,
        ...structuredClone(payload)
      };
      state.push(created);
      writes.push({ action: 'create', id: created.id });
      if (shouldLoseCreateResponse) {
        shouldLoseCreateResponse = false;
        throw new Error('Connection reset after GitHub accepted the create request.');
      }
      return structuredClone(created);
    },
    async updateRepositoryRuleset(_repository, rulesetId, payload) {
      const index = state.findIndex((entry) => entry.id === rulesetId);
      state[index] = { ...state[index], ...structuredClone(payload) };
      writes.push({ action: 'update', id: rulesetId });
      return structuredClone(state[index]);
    }
  };
}

function existingManagedRuleset(policy, changes = {}) {
  return {
    id: 42,
    source_type: 'Repository',
    source: REPOSITORY,
    ...rulesetPayloadFromPolicy(policy),
    ...changes
  };
}

test('policy projects to a symbolic default-branch GitHub ruleset payload', () => {
  const payload = rulesetPayloadFromPolicy(soloPolicy({
    requiredStatusChecks: ['test', 'build']
  }));

  assert.deepEqual(payload.conditions.ref_name, {
    include: ['~DEFAULT_BRANCH'],
    exclude: []
  });
  assert.deepEqual(payload.rules.map((rule) => rule.type), [
    'deletion',
    'non_fast_forward',
    'pull_request',
    'required_status_checks'
  ]);
  const checks = payload.rules.find((rule) => rule.type === 'required_status_checks');
  assert.deepEqual(checks.parameters.required_status_checks, [
    { context: 'build' },
    { context: 'test' }
  ]);
});

test('first reconcile creates once and the second reconcile is a no-op', async () => {
  const policy = soloPolicy();
  const client = inMemoryClient();

  const first = await reconcileRepositoryRuleset({
    repositoryFullName: REPOSITORY,
    policy,
    client
  });
  const second = await reconcileRepositoryRuleset({
    repositoryFullName: REPOSITORY,
    policy,
    client
  });

  assert.deepEqual(first, { action: 'create', changed: true, rulesetId: 1 });
  assert.deepEqual(second, { action: 'no-op', changed: false, rulesetId: 1 });
  assert.deepEqual(client.writes, [{ action: 'create', id: 1 }]);
});

test('managed policy drift causes one minimal update without recreation', async () => {
  const policy = soloPolicy();
  const client = inMemoryClient([
    existingManagedRuleset(policy, { enforcement: 'disabled' })
  ]);

  const result = await reconcileRepositoryRuleset({
    repositoryFullName: REPOSITORY,
    policy,
    client
  });

  assert.deepEqual(result, { action: 'update', changed: true, rulesetId: 42 });
  assert.deepEqual(client.writes, [{ action: 'update', id: 42 }]);
  assert.equal(client.state[0].enforcement, 'active');
});

test('unrelated repository rulesets remain untouched', async () => {
  const policy = soloPolicy();
  const unrelated = {
    id: 7,
    name: 'Company security policy',
    source_type: 'Repository',
    source: REPOSITORY,
    enforcement: 'active',
    target: 'branch',
    conditions: { ref_name: { include: ['~ALL'], exclude: [] } },
    rules: [{ type: 'required_signatures' }]
  };
  const client = inMemoryClient([unrelated]);

  await reconcileRepositoryRuleset({ repositoryFullName: REPOSITORY, policy, client });

  assert.equal(client.state.length, 2);
  assert.deepEqual(client.state[0], unrelated);
  assert.deepEqual(client.writes, [{ action: 'create', id: 8 }]);
});

test('retry after a lost create response does not duplicate the managed ruleset', async () => {
  const policy = soloPolicy();
  const client = inMemoryClient([], { loseFirstCreateResponse: true });

  await assert.rejects(
    () => reconcileRepositoryRuleset({ repositoryFullName: REPOSITORY, policy, client }),
    /Connection reset/
  );
  const retry = await reconcileRepositoryRuleset({
    repositoryFullName: REPOSITORY,
    policy,
    client
  });

  assert.deepEqual(retry, { action: 'no-op', changed: false, rulesetId: 1 });
  assert.equal(client.state.length, 1);
  assert.deepEqual(client.writes, [{ action: 'create', id: 1 }]);
});

test('duplicate managed names stop reconciliation before mutation', async () => {
  const policy = soloPolicy();
  const managed = existingManagedRuleset(policy);
  const client = inMemoryClient([managed, { ...managed, id: 43 }]);

  await assert.rejects(
    () => reconcileRepositoryRuleset({ repositoryFullName: REPOSITORY, policy, client }),
    /will not guess ownership/
  );
  assert.equal(client.writes.length, 0);
});

test('canonical comparison ignores GitHub response metadata but detects managed drift', () => {
  const desired = rulesetPayloadFromPolicy(soloPolicy());
  const current = {
    id: 42,
    node_id: 'RRS_example',
    created_at: '2026-09-16T00:00:00Z',
    source_type: 'Repository',
    source: REPOSITORY,
    ...structuredClone(desired)
  };

  assert.equal(rulesetsEquivalent(current, desired), true);
  current.conditions.ref_name.include = ['refs/heads/main'];
  assert.equal(rulesetsEquivalent(current, desired), false);
  assert.deepEqual(canonicalRuleset(desired).conditions.ref_name.include, ['~DEFAULT_BRANCH']);
});

test('unsupported rules inside the AppFactory-owned ruleset are treated as drift', () => {
  const desired = rulesetPayloadFromPolicy(soloPolicy());
  const current = structuredClone(desired);
  current.rules.push({ type: 'required_signatures' });

  assert.equal(rulesetsEquivalent(current, desired), false);
});

test('managed ruleset lookup is repository scoped and refuses ambiguity', () => {
  const policy = soloPolicy();
  const match = existingManagedRuleset(policy);
  assert.equal(findManagedRuleset([match], policy, REPOSITORY).id, 42);
  assert.equal(findManagedRuleset([
    { ...match, source_type: 'Organization', source: 'octo-org' }
  ], policy, REPOSITORY), null);
});
