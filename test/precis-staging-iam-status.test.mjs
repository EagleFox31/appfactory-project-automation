import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const workflow=readFileSync(new URL('../.github/workflows/auto-aws-free-plan-preflight.yml',import.meta.url),'utf8');
const script=readFileSync(new URL('../scripts/deployment/inspect-precis-staging-iam-stack.mjs',import.meta.url),'utf8');
test('check trusted pinned consumer template and live AWS status',()=>{
  assert.match(workflow,/ref: 18618e5ca8b76a3a6b62278e16e0c6fd2fd078fd/);
  assert.match(workflow,/inspect-precis-staging-iam-template\.mjs/);
  assert.match(workflow,/cloudformation validate-template/);
  assert.match(workflow,/inspect-precis-staging-iam-stack\.mjs/);
});
test('read-only probe refuses wrong stack and access-denied responses',()=>{
  assert.match(script,/Stack with id precis-staging-iam-readonly does not exist/);
  assert.match(script,/unexpected tenant stack status/);
  assert.match(script,/unexpected stack/);
  assert.match(script,/ReadOnlyRoleArn/);
  assert.match(script,/CloudFormation read error/);
});
test('neither the pipeline nor probe has AWS write operations',()=>{
  assert.doesNotMatch(workflow,/aws cloudformation (deploy|create-stack|execute-change-set|create-change-set)/);
  assert.doesNotMatch(workflow,/aws iam (create|put|attach|delete)|aws ec2 run-instances|aws ssm send-command/);
  assert.doesNotMatch(script,/execute-change-set|create-change-set|run-instances|send-command/);
});
