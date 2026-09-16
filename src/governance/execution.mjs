import { createGitHubRestClient } from '../github/rest-client.mjs';
import { formatRepositoryGovernancePlan, planRepositoryRuleset } from './plan.mjs';
import { preflightRepositoryGovernance } from './preflight.mjs';
import { applyRepositoryRulesetPlan } from './reconcile.mjs';

const GOVERNANCE_MODES = new Set(['off', 'plan', 'apply']);

export function normalizeGovernanceMode(value) {
  const mode = value === undefined || value === null || value === ''
    ? 'off'
    : String(value).trim().toLowerCase();
  if (!GOVERNANCE_MODES.has(mode)) {
    throw new Error(`Invalid governance-mode "${value}". Supported modes: off, plan, apply.`);
  }
  return mode;
}

export async function executeRepositoryGovernance({
  mode,
  repositoryFullName,
  policy,
  governanceToken,
  clientFactory = createGitHubRestClient
}) {
  const executionMode = normalizeGovernanceMode(mode);
  if (executionMode === 'off') {
    return { mode: 'off', status: 'skipped', preflight: null, plan: null, result: null };
  }

  if (!policy?.enabled) {
    const plan = await planRepositoryRuleset({ repositoryFullName, policy, client: null });
    return {
      mode: executionMode,
      status: 'disabled',
      preflight: null,
      plan,
      result: null
    };
  }

  let client = null;
  const preflight = await preflightRepositoryGovernance({
    repositoryFullName,
    policy,
    governanceToken,
    clientFactory(options) {
      client = clientFactory(options);
      return client;
    }
  });
  const plan = await planRepositoryRuleset({ repositoryFullName, policy, client });

  if (executionMode === 'plan') {
    return { mode: 'plan', status: 'planned', preflight, plan, result: null };
  }

  const result = await applyRepositoryRulesetPlan({ plan, client });
  return { mode: 'apply', status: 'applied', preflight, plan, result };
}

export function formatRepositoryGovernanceExecution(execution) {
  if (execution.mode === 'off') return 'Repository governance execution is off.';
  const planOutput = formatRepositoryGovernancePlan(execution.plan);
  if (execution.mode === 'plan' || !execution.result) return planOutput;
  const outcome = execution.result.changed
    ? `Applied: ${execution.result.action} completed (ruleset ${execution.result.rulesetId}).`
    : 'Applied: no changes were necessary.';
  return `${planOutput}\n${outcome}`;
}
