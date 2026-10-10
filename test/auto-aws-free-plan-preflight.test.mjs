import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,mkdtempSync,writeFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {spawnSync} from 'node:child_process';

const wf=readFileSync(new URL('../.github/workflows/auto-aws-free-plan-preflight.yml',import.meta.url),'utf8');
const cli=new URL('../scripts/deployment/auto-aws-free-plan-preflight.mjs',import.meta.url).pathname;
const valid={
  accountId:'458018461157',
  accountPlanType:'FREE',
  accountPlanStatus:'ACTIVE',
  accountPlanExpirationDate:'2027-03-15T00:00:00Z',
  accountPlanRemainingCredits:{amount:128.82,unit:'USD'}
};
function invoke({plan=valid,account='458018461157',event='push',ref='refs/heads/main',repo='EagleFox31/appfactory-project-automation'}={}){
  const dir=mkdtempSync(join(tmpdir(),'appfactory-auto-aws-'));
  try{
    writeFileSync(join(dir,'appfactory-auto-sts.json'),JSON.stringify({Account:account}));
    writeFileSync(join(dir,'appfactory-auto-freetier.json'),JSON.stringify(plan));
    return spawnSync(process.execPath,[cli],{
      encoding:'utf8',
      env:{...process.env,GITHUB_ACTIONS:'true',GITHUB_EVENT_NAME:event,GITHUB_REF:ref,
        GITHUB_REPOSITORY:repo,RUNNER_TEMP:dir,GITHUB_STEP_SUMMARY:join(dir,'summary')}
    });
  }finally{rmSync(dir,{force:true,recursive:true});}
}
test('automatic read-only preflight verifies actual account and plan shape',()=>{
  const r=invoke();
  assert.equal(r.status,0,r.stderr);
  assert.match(r.stdout,/FREE \/ ACTIVE/);
  assert.match(r.stdout,/128\.82/);
  assert.match(r.stdout,/No resources were created/);
});
test('push is limited to trusted main branch and repo',()=>{
  for(const changes of [
    {ref:'refs/heads/feature'},
    {repo:'EagleFox31/atelier2026'},
    {event:'pull_request'},
    {event:'pull_request_target'}
  ])assert.notEqual(invoke(changes).status,0);
});
test('refuses paid or expired plans and wrong account',()=>{
  for(const changes of [
    {account:'111111111111'},
    {plan:{...valid,accountPlanType:'PAID'}},
    {plan:{...valid,accountPlanStatus:'EXPIRED'}},
    {plan:{...valid,accountPlanRemainingCredits:{amount:5,unit:'USD'}}},
    {plan:{...valid,accountPlanExpirationDate:'2026-10-10T00:00:00Z'}}
  ]) assert.notEqual(invoke(changes).status,0);
});
test('automated workflow uses staging OIDC and cannot mutate AWS',()=>{
  assert.match(wf,/push:\s+branches: \[main\]/);
  assert.match(wf,/workflow_dispatch:/);
  assert.match(wf,/environment: staging/);
  assert.match(wf,/id-token: write/);
  assert.match(wf,/aws sts get-caller-identity/);
  assert.match(wf,/aws freetier get-account-plan-state/);
  assert.match(wf,/aws cloudformation validate-template/);
  assert.doesNotMatch(wf,/aws cloudformation (deploy|create-stack|create-change-set|execute-change-set|delete-stack)|aws iam|aws ec2|aws ssm|aws freetier upgrade-account-plan/);
  assert.doesNotMatch(wf,/\$\{\{ inputs\.apply \}\}|contents: write|packages: write/);
});
