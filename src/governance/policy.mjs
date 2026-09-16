export const GOVERNANCE_POLICY_VERSION = 1;
export const DEFAULT_BRANCH_REF = '~DEFAULT_BRANCH';

const GOVERNANCE_KEYS = new Set([
  'enabled',
  'preset',
  'rulesetName',
  'preventDeletion',
  'preventForcePush',
  'pullRequest',
  'requiredStatusChecks',
  'policyVersion',
  'enforcement',
  'target'
]);

const PULL_REQUEST_KEYS = new Set([
  'required',
  'requiredApprovingReviewCount',
  'dismissStaleReviewsOnPush',
  'requireCodeOwnerReview',
  'requireLastPushApproval',
  'requiredReviewThreadResolution'
]);

const SOLO_PRESET = Object.freeze({
  rulesetName: 'AppFactory default branch governance',
  preventDeletion: true,
  preventForcePush: true,
  pullRequest: Object.freeze({
    required: true,
    requiredApprovingReviewCount: 0,
    dismissStaleReviewsOnPush: false,
    requireCodeOwnerReview: false,
    requireLastPushApproval: false,
    requiredReviewThreadResolution: true
  }),
  requiredStatusChecks: Object.freeze([])
});

function isPlainObject(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function rejectUnknownKeys(value, allowed, path) {
  for (const key of Object.keys(value)) {
    if (!allowed.has(key)) {
      throw new Error(`${path}.${key} is not supported.`);
    }
  }
}

function booleanOverride(value, fallback, path) {
  if (value === undefined) return fallback;
  if (typeof value !== 'boolean') throw new Error(`${path} must be a boolean.`);
  return value;
}

function normalizeRulesetName(value, fallback) {
  if (value === undefined) return fallback;
  if (typeof value !== 'string') {
    throw new Error('repository.governance.rulesetName must be a string.');
  }

  const name = value.trim();
  if (!name) throw new Error('repository.governance.rulesetName cannot be empty.');
  if (name.length > 100) {
    throw new Error('repository.governance.rulesetName must be 100 characters or fewer.');
  }
  return name;
}

function normalizeRequiredStatusChecks(value, fallback) {
  const checks = value === undefined ? fallback : value;
  if (!Array.isArray(checks)) {
    throw new Error('repository.governance.requiredStatusChecks must be an array of check names.');
  }

  const result = new Set();
  for (const [index, rawCheck] of checks.entries()) {
    if (typeof rawCheck !== 'string') {
      throw new Error(`repository.governance.requiredStatusChecks[${index}] must be a string.`);
    }

    const check = rawCheck.trim();
    if (!check) {
      throw new Error(`repository.governance.requiredStatusChecks[${index}] cannot be empty.`);
    }
    if (check.length > 255) {
      throw new Error(
        `repository.governance.requiredStatusChecks[${index}] must be 255 characters or fewer.`
      );
    }
    result.add(check);
  }

  return [...result].sort((left, right) => left.localeCompare(right, 'en'));
}

function normalizePullRequest(value, preset) {
  if (value !== undefined && !isPlainObject(value)) {
    throw new Error('repository.governance.pullRequest must be an object.');
  }

  const override = value ?? {};
  rejectUnknownKeys(override, PULL_REQUEST_KEYS, 'repository.governance.pullRequest');

  const requiredApprovingReviewCount = override.requiredApprovingReviewCount
    ?? preset.requiredApprovingReviewCount;
  if (
    !Number.isInteger(requiredApprovingReviewCount)
    || requiredApprovingReviewCount < 0
    || requiredApprovingReviewCount > 6
  ) {
    throw new Error(
      'repository.governance.pullRequest.requiredApprovingReviewCount must be an integer from 0 to 6.'
    );
  }

  return {
    required: booleanOverride(
      override.required,
      preset.required,
      'repository.governance.pullRequest.required'
    ),
    requiredApprovingReviewCount,
    dismissStaleReviewsOnPush: booleanOverride(
      override.dismissStaleReviewsOnPush,
      preset.dismissStaleReviewsOnPush,
      'repository.governance.pullRequest.dismissStaleReviewsOnPush'
    ),
    requireCodeOwnerReview: booleanOverride(
      override.requireCodeOwnerReview,
      preset.requireCodeOwnerReview,
      'repository.governance.pullRequest.requireCodeOwnerReview'
    ),
    requireLastPushApproval: booleanOverride(
      override.requireLastPushApproval,
      preset.requireLastPushApproval,
      'repository.governance.pullRequest.requireLastPushApproval'
    ),
    requiredReviewThreadResolution: booleanOverride(
      override.requiredReviewThreadResolution,
      preset.requiredReviewThreadResolution,
      'repository.governance.pullRequest.requiredReviewThreadResolution'
    )
  };
}

function presetFor(name) {
  if (name === 'solo') return SOLO_PRESET;
  throw new Error(`Unknown repository governance preset: "${name}". Supported presets: solo.`);
}

function validateNormalizedContract(input) {
  const internalKeys = ['policyVersion', 'enforcement', 'target'];
  const supplied = internalKeys.filter((key) => input[key] !== undefined);
  if (!supplied.length) return;
  if (supplied.length !== internalKeys.length) {
    throw new Error(
      'Normalized repository governance policies must include policyVersion, enforcement and target together.'
    );
  }
  if (input.policyVersion !== GOVERNANCE_POLICY_VERSION) {
    throw new Error(
      `Unsupported repository governance policyVersion: ${input.policyVersion}.`
    );
  }
  if (input.enforcement !== 'active') {
    throw new Error('Normalized repository governance enforcement must be "active".');
  }
  if (
    !isPlainObject(input.target)
    || input.target.type !== 'branch'
    || !Array.isArray(input.target.include)
    || input.target.include.length !== 1
    || input.target.include[0] !== DEFAULT_BRANCH_REF
    || !Array.isArray(input.target.exclude)
    || input.target.exclude.length !== 0
  ) {
    throw new Error(
      `Normalized repository governance target must use the symbolic ${DEFAULT_BRANCH_REF} branch.`
    );
  }
}

export function normalizeGovernanceConfig(input) {
  if (input === undefined) return { enabled: false };
  if (!isPlainObject(input)) {
    throw new Error('repository.governance must be an object when provided.');
  }

  rejectUnknownKeys(input, GOVERNANCE_KEYS, 'repository.governance');
  validateNormalizedContract(input);

  const enabled = booleanOverride(input.enabled, false, 'repository.governance.enabled');
  if (input.preset !== undefined && typeof input.preset !== 'string') {
    throw new Error('repository.governance.preset must be a string.');
  }
  const presetName = input.preset?.trim() || 'solo';
  const preset = presetFor(presetName);
  const rulesetName = normalizeRulesetName(input.rulesetName, preset.rulesetName);
  const preventDeletion = booleanOverride(
    input.preventDeletion,
    preset.preventDeletion,
    'repository.governance.preventDeletion'
  );
  const preventForcePush = booleanOverride(
    input.preventForcePush,
    preset.preventForcePush,
    'repository.governance.preventForcePush'
  );
  const pullRequest = normalizePullRequest(input.pullRequest, preset.pullRequest);
  const requiredStatusChecks = normalizeRequiredStatusChecks(
    input.requiredStatusChecks,
    preset.requiredStatusChecks
  );

  if (!enabled) return { enabled: false };

  return {
    enabled: true,
    policyVersion: GOVERNANCE_POLICY_VERSION,
    preset: presetName,
    rulesetName,
    enforcement: 'active',
    target: {
      type: 'branch',
      include: [DEFAULT_BRANCH_REF],
      exclude: []
    },
    preventDeletion,
    preventForcePush,
    pullRequest,
    requiredStatusChecks
  };
}
