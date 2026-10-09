import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,writeFileSync,readFileSync,rmSync,mkdirSync,chmodSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {spawnSync} from 'node:child_process';

const script=new URL('../scripts/deployment/bootstrap-aws-free-plan-reader.sh',import.meta.url).pathname;
function invoke(args=[],overrides={}) {
  const dir=mkdtempSync(join(tmpdir(),'appfactory-iam-bootstrap-'));
  try {
    mkdirSync(join(dir,'bin'));
    const log=join(dir,'audit.log');
    const mock=join(dir,'bin','aws');
    writeFileSync(mock,[
      '#!/usr/bin/env bash',
      'set -euo pipefail',
      'echo "$*" >> "$APPFACTORY_TEST_LOG"',
      'case "$1 $2" in',
      '  "sts get-caller-identity") echo "$APPFACTORY_TEST_ACCOUNT";;',
      '  "iam get-open-id-connect-provider") echo "$APPFACTORY_TEST_AUDIENCE";;',
      '  "cloudformation deploy") exit 0;;',
      '  "cloudformation describe-stacks") echo "arn:aws:iam::458018461157:role/precis-translation-staging-free-plan-read";;',
      '  *) echo "Unexpected AWS API" >&2; exit 15;;',
      'esac'
    ].join('\n')+'\n');
    chmodSync(mock,0o755);
    const result=spawnSync('bash',[script,...args],{
      encoding:'utf8',
      env:{
        ...process.env,
        PATH:join(dir,'bin')+':'+process.env.PATH,
        APPFACTORY_TEST_LOG:log,
        APPFACTORY_TEST_ACCOUNT:'458018461157',
        APPFACTORY_TEST_AUDIENCE:'True',
        ...overrides
      }
    });
    let commands='';
    try {commands=readFileSync(log,'utf8')} catch {}
    return {status:result.status,stdout:result.stdout,stderr:result.stderr,commands};
  } finally {
    rmSync(dir,{recursive:true,force:true});
  }
}
test('dry-run verifies AWS identity/provider but never deploys',()=>{
  const r=invoke();
  assert.equal(r.status,0,r.stderr);
  assert.match(r.stdout,/DRY RUN ONLY/);
  assert.match(r.commands,/sts get-caller-identity/);
  assert.match(r.commands,/iam get-open-id-connect-provider/);
  assert.doesNotMatch(r.commands,/cloudformation deploy/);
});
test('one-time apply changes IAM only after explicit confirmation',()=>{
  const r=invoke(['--apply']);
  assert.equal(r.status,0,r.stderr);
  assert.match(r.commands,/cloudformation deploy/);
  assert.match(r.commands,/precis-staging-iam-readonly/);
  assert.match(r.stdout,/Read-only role ready/);
});
test('wrong AWS account and missing audience fail before deploy',()=>{
  for(const extra of [
    {APPFACTORY_TEST_ACCOUNT:'111111111111'},
    {APPFACTORY_TEST_AUDIENCE:'False'}
  ]) {
    const r=invoke(['--apply'],extra);
    assert.notEqual(r.status,0);
    assert.doesNotMatch(r.commands,/cloudformation deploy/);
  }
});
test('unrecognized flags cannot trigger deployment',()=>{
  const r=invoke(['--force']);
  assert.notEqual(r.status,0);
  assert.equal(r.commands,'');
});
test('reviewed template only creates a narrowly scoped read-only IAM role',()=>{
  const file=readFileSync(new URL('../infra/aws/appfactory-free-plan-reader.yml',import.meta.url),'utf8');
  assert.match(file,/AWS::IAM::Role/);
  assert.match(file,/freetier:GetAccountPlanState/);
  assert.match(file,/token.actions.githubusercontent.com:sub/);
  assert.match(file,/GitHubOwnerId/);
  assert.match(file,/GitHubRepositoryId/);
  assert.doesNotMatch(file,/AWS::EC2::Instance|AWS::IAM::Policy\b|iam:CreateRole|ssm:SendCommand|ec2:RunInstances/);
});
