import test from 'node:test';
import assert from 'node:assert/strict';
import {
  executeRepositoryGovernance,
  formatRepositoryGovernanceExecution,
  normalizeGovernanceMode
} from '../src/governance/execution.mjs';
import { normalizeGovernanceConfig } from '../src/governance/policy.mjs';
import { rulesetPayloadFromPolicy } from '../src/governance/ruleset.mjs';

const REPOSITORY = 'octo-org/product';
const POLICY = normalizeGovernanceConfig({ enabled: true, preset: 'solo' });

function managedRuleset(overrides = {}) {
  return {
    id: 42,
    source_type: 'Repository',
    source: REPOSITORY,
    ...rulesetPayloadFromPolicy(POLICY),
    ...overrides
  };
}

function clientFixture(initialRulesets = []) {
  const state = initialRulesets.map((entry) => structuredClone(entry));
  const calls = [];
  const writes = [];
  return {
    state,
    calls,
    writes,
    async getRepository(repositoryFullName) {
      calls.push('get-repository');
      return {
        full_name: repositoryFullName,
        visibility: 'private',
        permissions: { admin: true }
      };
    },
    async listRepositoryRulesets() {
      calls.push('list-rulesets');
      return state.map((entry) => structuredClone(entry));
    },
    async getRepositoryRuleset(_repository, id) {
      calls.push('get-ruleset');
      return structuredClone(state.find((entry) => entry.id === id));
    },
    async createRepositoryRuleset(repositoryFullName, desired) {
      calls.push('create-ruleset');
      const created = {
        id: 1,
        source_type: 'Repository',
        source: repositoryFullName,
        ...structuredClone(desired)
      };
      state.push(created);
      writes.push({ action: 'create', desired: structuredClone(desired) });
      return structuredClone(created);
    },
    async updateRepositoryRuleset(_repository, id, desired) {
      calls.push('update-ruleset');
      const index = state.findIndex((entry) => entry.id === id);
      state[index] = { ...state[index], ...structuredClone(desired) };
      writes.push({ action: 'update', desired: structuredClone(desired) });
      return structuredClone(state[index]);
    }
  };
}

test('governance mode defaults to off and rejects unknown values', () => {
  assert.equal(normalizeGovernanceMode(undefined), 'off');
  assert.equal(normalizeGovernanceMode(' PLAN '), 'plan');
  assert.equal(normalizeGovernanceMode('apply'), 'apply');
  assert.throws(() => normalizeGovernanceMode('automatic'), /off, plan, apply/);
});

test('off mode preserves legacy execution without creating a governance client', async () => {
  let factoryCalls = 0;
  const execution = await executeRepositoryGovernance({
    mode: 'off',
    repositoryFullName: REPOSITORY,
    policy: POLICY,
    governanceToken: '',
    clientFactory() {
      factoryCalls += 1;
      throw new Error('client must not be created');
    }
  });

  assert.equal(execution.status, 'skipped');
  assert.equal(factoryCalls, 0);
});

test('plan mode describes creation and performs zero mutation', async () => {
  const client = clientFixture([{ id: 7, name: 'Manual policy', source_type: 'Repository' }]);
  const execution = await executeRepositoryGovernance({
    mode: 'plan',
    repositoryFullName: REPOSITORY,
    policy: POLICY,
    governanceToken: 'dedicated-token',
    clientFactory: () => client
  });

  assert.equal(execution.plan.action, 'create');
  assert.equal(execution.plan.unrelatedRulesetCount, 1);
  assert.equal(execution.result, null);
  assert.deepEqual(client.writes, []);

  const output = formatRepositoryGovernanceExecution(execution);
  assert.match(output, /Action: CREATE AppFactory-managed ruleset/);
  assert.match(output, /default branch \(~DEFAULT_BRANCH\)/);
  assert.match(output, /Unrelated rulesets: 1 preserved/);
});

test('apply consumes the exact desired payload produced by its plan', async () => {
  const client = clientFixture();
  const execution = await executeRepositoryGovernance({
    mode: 'apply',
    repositoryFullName: REPOSITORY,
    policy: POLICY,
    governanceToken: 'dedicated-token',
    clientFactory: () => client
  });

  assert.equal(execution.result.action, 'create');
  assert.deepEqual(client.writes, [{
    action: 'create',
    desired: execution.plan.desired
  }]);
});

test('a second apply is an explicit no-op with no additional write', async () => {
  const client = clientFixture();

  await executeRepositoryGovernance({
    mode: 'apply',
    repositoryFullName: REPOSITORY,
    policy: POLICY,
    governanceToken: 'dedicated-token',
    clientFactory: () => client
  });
  const second = await executeRepositoryGovernance({
    mode: 'apply',
    repositoryFullName: REPOSITORY,
    policy: POLICY,
    governanceToken: 'dedicated-token',
    clientFactory: () => client
  });

  assert.equal(second.plan.action, 'no-op');
  assert.equal(second.result.changed, false);
  assert.equal(client.writes.length, 1);
  assert.match(formatRepositoryGovernanceExecution(second), /No changes/);
});

test('update plan shows drift while preserving unrelated rulesets', async () => {
  const client = clientFixture([
    managedRuleset({ enforcement: 'disabled' }),
    { id: 9, name: 'Security policy', source_type: 'Repository', source: REPOSITORY }
  ]);
  const execution = await executeRepositoryGovernance({
    mode: 'plan',
    repositoryFullName: REPOSITORY,
    policy: POLICY,
    governanceToken: 'dedicated-token',
    clientFactory: () => client
  });

  assert.equal(execution.plan.action, 'update');
  assert.equal(execution.plan.unrelatedRulesetCount, 1);
  assert.deepEqual(client.writes, []);
  assert.match(formatRepositoryGovernanceExecution(execution), /Enforcement: disabled -> active/);
});

test('disabled policy reports no changes without requesting a credential', async () => {
  const execution = await executeRepositoryGovernance({
    mode: 'plan',
    repositoryFullName: REPOSITORY,
    policy: { enabled: false },
    governanceToken: '',
    clientFactory() {
      throw new Error('client must not be created');
    }
  });

  assert.equal(execution.status, 'disabled');
  assert.match(formatRepositoryGovernanceExecution(execution), /disabled.*no changes/i);
});
