import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const workflow=readFileSync(new URL('../.github/workflows/reusable-aws-free-plan-preflight.yml',import.meta.url),'utf8');
const script=readFileSync(new URL('../scripts/deployment/verify-aws-free-plan.mjs',import.meta.url),'utf8');

test('Free Plan preflight requires manual protected staging and pinned source',()=>{
  assert.match(workflow,/workflow_call:/);
  assert.match(workflow,/environment: staging/);
  assert.match(workflow,/id-token: write/);
  assert.match(workflow,/GITHUB_EVENT_NAME/);
  assert.match(workflow,/workflow_dispatch/);
  assert.match(workflow,/refs\/heads\/main/);
  assert.match(workflow,/\[a-f0-9\]\{40\}/);
  assert.match(workflow,/configure-aws-credentials@v4/);
  assert.match(script,/GITHUB_EVENT_NAME!==[\x27]workflow_dispatch[\x27]/);
});
test('Free Plan preflight has no cloud writes, costs or paid upgrade',()=>{
  assert.match(workflow,/aws sts get-caller-identity/);
  assert.match(workflow,/aws freetier get-account-plan-state/);
  assert.doesNotMatch(workflow,/^\s*aws\s+(ec2|ssm|iam|cloudformation|budgets|organizations)\b/m);
  assert.doesNotMatch(workflow,/upgrade-account-plan|run-instances|send-command|create-stack/);
  assert.doesNotMatch(workflow,/packages:\s*write|contents:\s*write/);
});
