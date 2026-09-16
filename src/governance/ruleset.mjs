import { GOVERNANCE_POLICY_VERSION } from './policy.mjs';

const ALLOWED_MERGE_METHODS = Object.freeze(['merge', 'squash', 'rebase']);

function stableStrings(values = []) {
  const entries = Array.isArray(values) ? values : [];
  return [...new Set(entries.map((value) => String(value)))].sort((left, right) => (
    left.localeCompare(right, 'en')
  ));
}

function statusChecksRule(contexts) {
  if (!contexts.length) return null;
  return {
    type: 'required_status_checks',
    parameters: {
      do_not_enforce_on_create: false,
      required_status_checks: contexts.map((context) => ({ context })),
      strict_required_status_checks_policy: true
    }
  };
}

function pullRequestRule(settings) {
  if (!settings.required) return null;
  return {
    type: 'pull_request',
    parameters: {
      allowed_merge_methods: [...ALLOWED_MERGE_METHODS],
      dismiss_stale_reviews_on_push: settings.dismissStaleReviewsOnPush,
      require_code_owner_review: settings.requireCodeOwnerReview,
      require_last_push_approval: settings.requireLastPushApproval,
      required_approving_review_count: settings.requiredApprovingReviewCount,
      required_review_thread_resolution: settings.requiredReviewThreadResolution
    }
  };
}

export function rulesetPayloadFromPolicy(policy) {
  if (!policy?.enabled) {
    throw new Error('An enabled normalized governance policy is required.');
  }
  if (policy.policyVersion !== GOVERNANCE_POLICY_VERSION) {
    throw new Error(`Unsupported governance policy version: ${policy.policyVersion}.`);
  }
  if (policy.target?.type !== 'branch') {
    throw new Error('Repository Governance V1 only supports branch rulesets.');
  }

  const rules = [
    policy.preventDeletion ? { type: 'deletion' } : null,
    policy.preventForcePush ? { type: 'non_fast_forward' } : null,
    pullRequestRule(policy.pullRequest),
    statusChecksRule(policy.requiredStatusChecks)
  ].filter(Boolean);

  return {
    name: policy.rulesetName,
    target: 'branch',
    enforcement: policy.enforcement,
    bypass_actors: [],
    conditions: {
      ref_name: {
        include: [...policy.target.include],
        exclude: [...policy.target.exclude]
      }
    },
    rules
  };
}

function canonicalStatusChecks(parameters = {}) {
  return (parameters.required_status_checks ?? [])
    .map((entry) => ({
      context: String(entry.context ?? ''),
      ...(entry.integration_id === undefined || entry.integration_id === null
        ? {}
        : { integration_id: entry.integration_id })
    }))
    .sort((left, right) => left.context.localeCompare(right.context, 'en'));
}

function canonicalRule(rule) {
  switch (rule?.type) {
    case 'deletion':
    case 'non_fast_forward':
      return { type: rule.type };
    case 'pull_request':
      return {
        type: 'pull_request',
        parameters: {
          allowed_merge_methods: stableStrings(rule.parameters?.allowed_merge_methods),
          dismiss_stale_reviews_on_push: Boolean(rule.parameters?.dismiss_stale_reviews_on_push),
          require_code_owner_review: Boolean(rule.parameters?.require_code_owner_review),
          require_last_push_approval: Boolean(rule.parameters?.require_last_push_approval),
          required_approving_review_count: Number(
            rule.parameters?.required_approving_review_count ?? 0
          ),
          required_review_thread_resolution: Boolean(
            rule.parameters?.required_review_thread_resolution
          )
        }
      };
    case 'required_status_checks':
      return {
        type: 'required_status_checks',
        parameters: {
          do_not_enforce_on_create: Boolean(rule.parameters?.do_not_enforce_on_create),
          required_status_checks: canonicalStatusChecks(rule.parameters),
          strict_required_status_checks_policy: Boolean(
            rule.parameters?.strict_required_status_checks_policy
          )
        }
      };
    default:
      return { type: String(rule?.type ?? ''), unsupported: true };
  }
}

export function canonicalRuleset(value) {
  const rules = (value?.rules ?? [])
    .map(canonicalRule)
    .filter(Boolean)
    .sort((left, right) => left.type.localeCompare(right.type, 'en'));

  return {
    name: String(value?.name ?? ''),
    target: String(value?.target ?? ''),
    enforcement: String(value?.enforcement ?? ''),
    bypass_actors: (value?.bypass_actors ?? [])
      .map((actor) => ({
        actor_id: actor.actor_id ?? null,
        actor_type: String(actor.actor_type ?? ''),
        bypass_mode: String(actor.bypass_mode ?? 'always')
      }))
      .sort((left, right) => JSON.stringify(left).localeCompare(JSON.stringify(right), 'en')),
    conditions: {
      ref_name: {
        include: stableStrings(value?.conditions?.ref_name?.include),
        exclude: stableStrings(value?.conditions?.ref_name?.exclude)
      }
    },
    rules
  };
}

export function rulesetsEquivalent(current, desired) {
  return JSON.stringify(canonicalRuleset(current)) === JSON.stringify(canonicalRuleset(desired));
}

export function findManagedRuleset(rulesets, policy, repositoryFullName) {
  const repositoryKey = String(repositoryFullName).toLowerCase();
  const matches = (rulesets ?? []).filter((ruleset) => {
    if (ruleset?.name !== policy.rulesetName) return false;
    if (ruleset.source_type && ruleset.source_type !== 'Repository') return false;
    if (ruleset.source && String(ruleset.source).toLowerCase() !== repositoryKey) return false;
    return true;
  });

  if (matches.length > 1) {
    throw new Error(
      `Multiple repository rulesets are named "${policy.rulesetName}". `
      + 'AppFactory will not guess ownership; rename or remove the duplicate rulesets first.'
    );
  }
  const managed = matches[0] ?? null;
  if (managed && (!Number.isSafeInteger(managed.id) || managed.id <= 0)) {
    throw new Error(
      `Managed repository ruleset "${policy.rulesetName}" has an invalid GitHub id.`
    );
  }
  return managed;
}
