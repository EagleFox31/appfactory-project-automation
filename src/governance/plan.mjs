import {
  canonicalRuleset,
  findManagedRuleset,
  rulesetPayloadFromPolicy,
  rulesetsEquivalent
} from './ruleset.mjs';
import { buildBrownfieldAdoptionReport } from './adoption.mjs';
import { discoverRepositoryGovernanceState } from './discovery.mjs';

const VIEW_FIELDS = Object.freeze([
  ['enforcement', 'Enforcement'],
  ['branchTarget', 'Branch target'],
  ['preventDeletion', 'Prevent branch deletion'],
  ['preventForcePush', 'Prevent force pushes'],
  ['requirePullRequest', 'Require pull requests'],
  ['requiredApprovals', 'Required approving reviews'],
  ['dismissStaleReviews', 'Dismiss stale reviews after new commits'],
  ['requireCodeOwners', 'Require CODEOWNERS review'],
  ['requireLastPushApproval', 'Require approval after the last push'],
  ['resolveReviewThreads', 'Require review-thread resolution'],
  ['allowedMergeMethods', 'Allowed merge methods'],
  ['requiredStatusChecks', 'Required status checks'],
  ['strictStatusChecks', 'Require branches to be up to date'],
  ['bypassActors', 'Ruleset bypass actors'],
  ['unsupportedRules', 'Rules outside the AppFactory policy']
]);

function ruleByType(ruleset, type) {
  return ruleset.rules.find((rule) => rule.type === type) ?? null;
}

function branchTarget(ruleset) {
  const include = ruleset.conditions.ref_name.include;
  const exclude = ruleset.conditions.ref_name.exclude;
  if (include.length === 1 && include[0] === '~DEFAULT_BRANCH' && exclude.length === 0) {
    return 'default branch (~DEFAULT_BRANCH)';
  }
  const exclusions = exclude.length ? `; excluding ${exclude.join(', ')}` : '';
  return `${include.join(', ') || '(none)'}${exclusions}`;
}

function rulesetView(value) {
  const ruleset = canonicalRuleset(value);
  const pullRequest = ruleByType(ruleset, 'pull_request');
  const statusChecks = ruleByType(ruleset, 'required_status_checks');

  return {
    enforcement: ruleset.enforcement,
    branchTarget: branchTarget(ruleset),
    preventDeletion: Boolean(ruleByType(ruleset, 'deletion')),
    preventForcePush: Boolean(ruleByType(ruleset, 'non_fast_forward')),
    requirePullRequest: Boolean(pullRequest),
    requiredApprovals: pullRequest?.parameters.required_approving_review_count ?? 0,
    dismissStaleReviews: pullRequest?.parameters.dismiss_stale_reviews_on_push ?? false,
    requireCodeOwners: pullRequest?.parameters.require_code_owner_review ?? false,
    requireLastPushApproval: pullRequest?.parameters.require_last_push_approval ?? false,
    resolveReviewThreads: pullRequest?.parameters.required_review_thread_resolution ?? false,
    allowedMergeMethods: pullRequest?.parameters.allowed_merge_methods ?? [],
    requiredStatusChecks: (statusChecks?.parameters.required_status_checks ?? [])
      .map((entry) => entry.integration_id === undefined
        ? entry.context
        : `${entry.context} (integration ${entry.integration_id})`),
    strictStatusChecks: statusChecks?.parameters.strict_required_status_checks_policy ?? false,
    bypassActors: ruleset.bypass_actors.map((actor) => (
      `${actor.actor_type}:${actor.actor_id ?? 'all'}:${actor.bypass_mode}`
    )),
    unsupportedRules: ruleset.rules
      .filter((rule) => rule.unsupported)
      .map((rule) => rule.type)
  };
}

function equalValue(left, right) {
  return JSON.stringify(left) === JSON.stringify(right);
}

function emptyValue(value) {
  return value === false
    || value === 0
    || value === null
    || value === undefined
    || (Array.isArray(value) && value.length === 0);
}

function changesBetween(current, desired, action) {
  const before = current ? rulesetView(current) : null;
  const after = rulesetView(desired);
  const changes = [];

  for (const [key, label] of VIEW_FIELDS) {
    const beforeValue = before?.[key] ?? null;
    const afterValue = after[key];
    if (action === 'create' && emptyValue(afterValue)) continue;
    if (action === 'create' || !equalValue(beforeValue, afterValue)) {
      changes.push({
        kind: action === 'create' ? 'add' : 'change',
        setting: key,
        label,
        before: beforeValue,
        after: afterValue
      });
    }
  }

  if (action === 'update' && changes.length === 0) {
    changes.push({
      kind: 'change',
      setting: 'managedStructure',
      label: 'Managed ruleset structure',
      before: 'repository drift',
      after: 'AppFactory policy'
    });
  }
  return changes;
}

export async function planRepositoryRuleset({
  repositoryFullName,
  policy,
  client,
  discovery: suppliedDiscovery
}) {
  if (!policy?.enabled) {
    return {
      action: 'disabled',
      changed: false,
      repositoryFullName,
      ownership: 'AppFactory-managed',
      rulesetName: null,
      rulesetId: null,
      unrelatedRulesetCount: 0,
      adoption: null,
      desired: null,
      changes: []
    };
  }
  if (!client) throw new Error('A repository ruleset client is required.');

  const desired = rulesetPayloadFromPolicy(policy);
  const discovery = suppliedDiscovery ?? await discoverRepositoryGovernanceState({
    repositoryFullName,
    client
  });
  const rulesets = discovery.rulesets;
  const managed = findManagedRuleset(rulesets, policy, repositoryFullName);
  const unrelatedRulesetCount = rulesets.length - (managed ? 1 : 0);
  const adoption = buildBrownfieldAdoptionReport({
    policy,
    discovery,
    managedRuleset: managed
  });

  if (!managed) {
    return {
      action: 'create',
      changed: true,
      repositoryFullName,
      ownership: 'AppFactory-managed',
      rulesetName: policy.rulesetName,
      rulesetId: null,
      unrelatedRulesetCount,
      adoption,
      desired,
      changes: changesBetween(null, desired, 'create')
    };
  }

  const current = await client.getRepositoryRuleset(repositoryFullName, managed.id);
  if (rulesetsEquivalent(current, desired)) {
    return {
      action: 'no-op',
      changed: false,
      repositoryFullName,
      ownership: 'AppFactory-managed',
      rulesetName: policy.rulesetName,
      rulesetId: managed.id,
      unrelatedRulesetCount,
      adoption,
      desired,
      changes: []
    };
  }

  return {
    action: 'update',
    changed: true,
    repositoryFullName,
    ownership: 'AppFactory-managed',
    rulesetName: policy.rulesetName,
    rulesetId: managed.id,
    unrelatedRulesetCount,
    adoption,
    desired,
    changes: changesBetween(current, desired, 'update')
  };
}

function displayValue(value) {
  if (Array.isArray(value)) return value.length ? value.join(', ') : '(none)';
  if (typeof value === 'boolean') return value ? 'enabled' : 'disabled';
  if (value === null || value === undefined || value === '') return '(none)';
  return String(value);
}

export function formatRepositoryGovernancePlan(plan) {
  if (plan.action === 'disabled') {
    return `Repository governance is disabled for ${plan.repositoryFullName}; no changes.`;
  }

  const lines = [
    `Repository governance plan for ${plan.repositoryFullName}`,
    `Action: ${plan.action.toUpperCase()} ${plan.ownership} ruleset "${plan.rulesetName}"`,
    `Target: ${rulesetView(plan.desired).branchTarget}`,
    `Default branch: ${plan.adoption.defaultBranch} preserved`,
    `Classic branch protection: ${plan.adoption.classicBranchProtection.present ? 'present and preserved' : 'none detected'}`,
    `Unrelated rulesets: ${plan.unrelatedRulesetCount} preserved`
  ];

  for (const finding of plan.adoption.findings) {
    lines.push(`${finding.level === 'warning' ? '!' : 'i'} Brownfield: ${finding.message}`);
  }
  for (const ruleset of plan.adoption.unrelatedRulesets) {
    lines.push(`i Preserved ruleset: "${ruleset.name}" (${ruleset.enforcement})`);
  }

  if (plan.action === 'no-op') {
    lines.push('= No changes; the managed ruleset already matches the desired policy.');
    return lines.join('\n');
  }

  lines.push('Changes:');
  for (const change of plan.changes) {
    if (change.kind === 'add') {
      lines.push(`+ ${change.label}: ${displayValue(change.after)}`);
    } else {
      lines.push(
        `~ ${change.label}: ${displayValue(change.before)} -> ${displayValue(change.after)}`
      );
    }
  }
  return lines.join('\n');
}
