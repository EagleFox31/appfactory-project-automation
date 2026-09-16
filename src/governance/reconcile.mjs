import { planRepositoryRuleset } from './plan.mjs';

function resolvedRulesetId(response, fallback, action) {
  const id = response?.id ?? fallback;
  if (!Number.isSafeInteger(id) || id <= 0) {
    throw new Error(`GitHub did not return a valid ruleset id after ${action}.`);
  }
  return id;
}

export async function applyRepositoryRulesetPlan({ plan, client }) {
  if (!plan || typeof plan.action !== 'string') {
    throw new Error('A valid repository governance plan is required.');
  }
  if (plan.action === 'disabled') {
    return { action: 'disabled', changed: false, rulesetId: null };
  }
  if (!client) throw new Error('A repository ruleset client is required.');
  if (plan.action === 'no-op') {
    return { action: 'no-op', changed: false, rulesetId: plan.rulesetId };
  }
  if (plan.action === 'create') {
    const created = await client.createRepositoryRuleset(
      plan.repositoryFullName,
      plan.desired
    );
    return {
      action: 'create',
      changed: true,
      rulesetId: resolvedRulesetId(created, null, 'creation')
    };
  }
  if (plan.action === 'update') {
    const updated = await client.updateRepositoryRuleset(
      plan.repositoryFullName,
      plan.rulesetId,
      plan.desired
    );
    return {
      action: 'update',
      changed: true,
      rulesetId: resolvedRulesetId(updated, plan.rulesetId, 'update')
    };
  }

  throw new Error(`Unsupported repository governance plan action: ${plan.action}.`);
}

export async function reconcileRepositoryRuleset({ repositoryFullName, policy, client }) {
  const plan = await planRepositoryRuleset({ repositoryFullName, policy, client });
  return applyRepositoryRulesetPlan({ plan, client });
}
