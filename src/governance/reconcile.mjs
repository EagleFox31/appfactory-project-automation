import {
  findManagedRuleset,
  rulesetPayloadFromPolicy,
  rulesetsEquivalent
} from './ruleset.mjs';

function resolvedRulesetId(response, fallback, action) {
  const id = response?.id ?? fallback;
  if (!Number.isSafeInteger(id) || id <= 0) {
    throw new Error(`GitHub did not return a valid ruleset id after ${action}.`);
  }
  return id;
}

export async function reconcileRepositoryRuleset({
  repositoryFullName,
  policy,
  client
}) {
  if (!policy?.enabled) {
    return { action: 'disabled', changed: false, rulesetId: null };
  }
  if (!client) throw new Error('A repository ruleset client is required.');

  const desired = rulesetPayloadFromPolicy(policy);
  const rulesets = await client.listRepositoryRulesets(repositoryFullName);
  const managed = findManagedRuleset(rulesets, policy, repositoryFullName);

  if (!managed) {
    const created = await client.createRepositoryRuleset(repositoryFullName, desired);
    return {
      action: 'create',
      changed: true,
      rulesetId: resolvedRulesetId(created, null, 'creation')
    };
  }

  const current = await client.getRepositoryRuleset(repositoryFullName, managed.id);
  if (rulesetsEquivalent(current, desired)) {
    return { action: 'no-op', changed: false, rulesetId: managed.id };
  }

  const updated = await client.updateRepositoryRuleset(
    repositoryFullName,
    managed.id,
    desired
  );
  return {
    action: 'update',
    changed: true,
    rulesetId: resolvedRulesetId(updated, managed.id, 'update')
  };
}
