import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { executeRepositoryGovernance } from '../src/governance/execution.mjs';
import {
  GOVERNANCE_POLICY_VERSION,
  normalizeGovernanceConfig
} from '../src/governance/policy.mjs';
import { rulesetPayloadFromPolicy } from '../src/governance/ruleset.mjs';
import { validateConfig } from '../src/lib.mjs';

const consumers = JSON.parse(fs.readFileSync(
  new URL('./fixtures/raider-consumers.json', import.meta.url),
  'utf8'
));
const legacyProjectConfig = JSON.parse(fs.readFileSync(
  new URL('./fixtures/legacy-project-config.json', import.meta.url),
  'utf8'
));

function consumerClient(
  consumer,
  { initialRulesets = [], classicBranchProtection = null } = {}
) {
  const state = initialRulesets.map((ruleset) => structuredClone(ruleset));
  const classicState = structuredClone(classicBranchProtection);
  const writes = [];
  const inspectedBranches = [];
  let nextId = Math.max(0, ...state.map((ruleset) => ruleset.id ?? 0)) + 1;

  return {
    state,
    writes,
    inspectedBranches,
    classicState,
    async getRepository(repositoryFullName) {
      assert.equal(repositoryFullName, consumer.repositoryFullName);
      return {
        full_name: repositoryFullName,
        visibility: 'private',
        default_branch: consumer.defaultBranch,
        owner: { type: consumer.ownerType },
        permissions: { admin: true }
      };
    },
    async getBranchProtection(repositoryFullName, branchName) {
      assert.equal(repositoryFullName, consumer.repositoryFullName);
      inspectedBranches.push(branchName);
      return structuredClone(classicState);
    },
    async listRepositoryRulesets() {
      return state.map((ruleset) => structuredClone(ruleset));
    },
    async getRepositoryRuleset(_repositoryFullName, rulesetId) {
      return structuredClone(state.find((ruleset) => ruleset.id === rulesetId));
    },
    async createRepositoryRuleset(repositoryFullName, desired) {
      const created = {
        id: nextId++,
        source_type: 'Repository',
        source: repositoryFullName,
        ...structuredClone(desired)
      };
      state.push(created);
      writes.push({ action: 'create', id: created.id, desired: structuredClone(desired) });
      return structuredClone(created);
    },
    async updateRepositoryRuleset(_repositoryFullName, rulesetId, desired) {
      const index = state.findIndex((ruleset) => ruleset.id === rulesetId);
      state[index] = { ...state[index], ...structuredClone(desired) };
      writes.push({ action: 'update', id: rulesetId, desired: structuredClone(desired) });
      return structuredClone(state[index]);
    }
  };
}

async function execute(consumer, client, policy, mode) {
  return executeRepositoryGovernance({
    mode,
    repositoryFullName: consumer.repositoryFullName,
    policy,
    governanceToken: 'fixture-governance-token',
    clientFactory: () => client
  });
}

function statusCheckContexts(desired) {
  const rule = desired.rules.find((entry) => entry.type === 'required_status_checks');
  return rule?.parameters.required_status_checks.map((entry) => entry.context) ?? [];
}

test('RAIDER reusable/agnostic/idempotent contract holds across consumer fixtures', async () => {
  for (const consumer of consumers) {
    const policy = normalizeGovernanceConfig({
      enabled: true,
      preset: 'solo',
      requiredStatusChecks: consumer.requiredStatusChecks
    });
    const client = consumerClient(consumer);

    const planned = await execute(consumer, client, policy, 'plan');
    assert.equal(planned.plan.action, 'create', consumer.name);
    assert.deepEqual(client.writes, [], consumer.name);

    const firstApply = await execute(consumer, client, policy, 'apply');
    assert.equal(firstApply.result.action, 'create', consumer.name);
    assert.deepEqual(firstApply.plan.desired, planned.plan.desired, consumer.name);
    assert.deepEqual(
      firstApply.plan.desired.conditions.ref_name,
      { include: ['~DEFAULT_BRANCH'], exclude: [] },
      consumer.name
    );
    assert.deepEqual(
      statusCheckContexts(firstApply.plan.desired),
      [...consumer.requiredStatusChecks].sort((left, right) => left.localeCompare(right, 'en')),
      consumer.name
    );

    const secondApply = await execute(consumer, client, policy, 'apply');
    assert.equal(secondApply.result.action, 'no-op', consumer.name);
    assert.equal(secondApply.result.changed, false, consumer.name);
    assert.equal(client.writes.length, 1, consumer.name);
    assert.equal(client.writes[0].action, 'create', consumer.name);
    assert.ok(
      client.inspectedBranches.every((branch) => branch === consumer.defaultBranch),
      consumer.name
    );
  }
});

test('RAIDER retroactive contract converges owned drift without touching manual protection', async () => {
  const consumer = consumers.find((entry) => entry.defaultBranch === 'trunk');
  const policy = normalizeGovernanceConfig({
    enabled: true,
    preset: 'solo',
    requiredStatusChecks: ['quality / verify']
  });
  const manualRuleset = {
    id: 7,
    name: 'Manual security policy',
    source_type: 'Repository',
    source: consumer.repositoryFullName,
    enforcement: 'active',
    target: 'branch',
    conditions: { ref_name: { include: ['refs/heads/release/*'], exclude: [] } },
    rules: [{ type: 'required_signatures' }]
  };
  const managedRuleset = {
    id: 42,
    source_type: 'Repository',
    source: consumer.repositoryFullName,
    ...rulesetPayloadFromPolicy(policy),
    enforcement: 'disabled'
  };
  const classicProtection = {
    required_status_checks: {
      strict: true,
      checks: [{ context: 'legacy-ci', app_id: null }]
    },
    required_pull_request_reviews: { required_approving_review_count: 2 },
    required_linear_history: { enabled: true }
  };
  const client = consumerClient(consumer, {
    initialRulesets: [managedRuleset, manualRuleset],
    classicBranchProtection: classicProtection
  });

  const firstApply = await execute(consumer, client, policy, 'apply');
  assert.deepEqual(firstApply.result, { action: 'update', changed: true, rulesetId: 42 });
  assert.deepEqual(client.writes.map(({ action, id }) => ({ action, id })), [
    { action: 'update', id: 42 }
  ]);
  assert.deepEqual(client.state.find((ruleset) => ruleset.id === 7), manualRuleset);
  assert.deepEqual(client.classicState, classicProtection);

  const secondApply = await execute(consumer, client, policy, 'apply');
  assert.equal(secondApply.result.action, 'no-op');
  assert.equal(client.writes.length, 1);
  assert.match(
    firstApply.plan.adoption.findings.map((finding) => finding.message).join('\n'),
    /legacy-ci/
  );
});

test('RAIDER durable contract keeps legacy config and versioned policy behavior stable', () => {
  const input = structuredClone(legacyProjectConfig);
  const before = structuredClone(input);
  const validated = validateConfig(input);

  assert.deepEqual(input, before);
  assert.equal(validated.project.owner, 'legacy-owner');
  assert.equal(validated.statusTransitions.issueOpened, 'Backlog');
  assert.deepEqual(validated.repository.governance, { enabled: false });
  assert.equal(GOVERNANCE_POLICY_VERSION, 1);

  const canonical = normalizeGovernanceConfig({ enabled: true, preset: 'solo' });
  assert.throws(
    () => normalizeGovernanceConfig({ ...canonical, policyVersion: 2 }),
    /Unsupported repository governance policyVersion: 2/
  );
});
