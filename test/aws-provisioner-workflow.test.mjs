import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const wf=readFileSync(new URL('../.github/workflows/reusable-aws-provisioner-readiness.yml',import.meta.url),'utf8');
const runner=readFileSync(new URL('../scripts/deployment/verify-aws-provisioner-readiness.mjs',import.meta.url),'utf8');
test('audit is called only from protected manual main branch',()=>{
  assert.match(wf,/workflow_call:/);
  assert.match(wf,/environment: staging/);
  assert.match(wf,/id-token: write/);
  assert.match(wf,/GITHUB_EVENT_NAME.*workflow_dispatch/);
  assert.match(wf,/GITHUB_REF.*refs\/heads\/main/);
  assert.match(wf,/\[a-f0-9\]\{40\}/);
  assert.match(runner,/GITHUB_EVENT_NAME/);
});
test('audit invokes only STS and IAM GET/simulation, never AWS mutations',()=>{
  assert.match(wf,/aws sts get-caller-identity/);
  assert.match(wf,/aws iam get-role/);
  assert.match(wf,/aws iam simulate-principal-policy/);
  assert.doesNotMatch(wf,/^\s*aws\s+(cloudformation|ec2|ssm|budgets|organizations|iam\s+(create|put|update|attach|pass|delete))\b/m);
  assert.doesNotMatch(wf,/aws cloudformation (deploy|create-stack|create-change-set|execute-change-set)/);
  assert.doesNotMatch(wf,/^\s*packages: write|^\s*contents: write/m);
});
test('IAM simulated service and tenant roles differ from caller identity',()=>{
  assert.match(wf,/RUNNER_ROLE_ARN/);
  assert.match(wf,/CFN_SERVICE_ROLE_ARN/);
  assert.match(wf,/TARGET_ROLE_ARN/);
  assert.match(wf,/TARGET_STACK_ARN/);
  assert.match(wf,/iam:PassRole/);
  assert.match(wf,/iam:CreateRole/);
});
