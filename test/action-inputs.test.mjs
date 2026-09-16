import test from 'node:test';
import assert from 'node:assert/strict';

import {
  actionInputEnvironmentName,
  readActionInput
} from '../src/action-inputs.mjs';

test('GitHub Action input environment names preserve hyphens', () => {
  assert.equal(actionInputEnvironmentName('governance-mode'), 'INPUT_GOVERNANCE-MODE');
  assert.equal(actionInputEnvironmentName('governance-token'), 'INPUT_GOVERNANCE-TOKEN');
  assert.equal(actionInputEnvironmentName('token'), 'INPUT_TOKEN');
});

test('readActionInput consumes the environment names emitted by GitHub Actions', () => {
  const environment = {
    'INPUT_GOVERNANCE-MODE': 'plan',
    'INPUT_GOVERNANCE-TOKEN': 'governance-secret',
    'INPUT_CONFIG-PATH': '.github/project-config.json',
    'INPUT_ISSUE-NUMBER': '#24'
  };

  assert.equal(readActionInput('governance-mode', environment), 'plan');
  assert.equal(readActionInput('governance-token', environment), 'governance-secret');
  assert.equal(readActionInput('config-path', environment), '.github/project-config.json');
  assert.equal(readActionInput('issue-number', environment), '#24');
});

test('readActionInput keeps underscore compatibility without overriding canonical input', () => {
  assert.equal(readActionInput('governance-mode', {
    INPUT_GOVERNANCE_MODE: 'apply'
  }), 'apply');

  assert.equal(readActionInput('governance-mode', {
    'INPUT_GOVERNANCE-MODE': 'plan',
    INPUT_GOVERNANCE_MODE: 'apply'
  }), 'plan');
});

test('readActionInput treats an explicitly empty canonical input as authoritative', () => {
  assert.equal(readActionInput('governance-token', {
    'INPUT_GOVERNANCE-TOKEN': '',
    INPUT_GOVERNANCE_TOKEN: 'legacy-secret'
  }), '');
});

test('actionInputEnvironmentName rejects invalid input names', () => {
  assert.throws(() => actionInputEnvironmentName(''), /non-empty string/);
  assert.throws(() => actionInputEnvironmentName(null), /non-empty string/);
});
