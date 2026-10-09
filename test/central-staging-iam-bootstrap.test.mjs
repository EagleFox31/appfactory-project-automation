import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,writeFileSync,mkdirSync,mkdtempSync,rmSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {spawnSync} from 'node:child_process';
const central=readFileSync(new URL('../infra/aws/appfactory-central-staging-iam-bootstrap.yml',import.meta.url),'utf8');
const workflow=readFileSync(new URL('../.github/workflows/appfactory-precis-staging-iam.yml',import.meta.url),'utf8');
const checker=new URL('../scripts/deployment/inspect-precis-staging-iam-changeset.mjs',import.meta.url).pathname;
function evaluateChangeSet(data) {
  const dir=mkdtempSync(join(tmpdir(),'appfactory-cfn-gate-'));
  try{
    writeFileSync(join(dir,'appfactory-precis-changeset.json'),JSON.stringify(data));
    return spawnSync(process.execPath,[checker],{
      env:{...process.env,RUNNER_TEMP:dir,GITHUB_EVENT_NAME:'workflow_dispatch',
      GITHUB_REF:'refs/heads/main',GITHUB_RUN_ID:'4832',
      CHANGESET:'appfactory-precis-staging-4832'},
      encoding:'utf8'
    });
  } finally {rmSync(dir,{force:true,recursive:true});}
}
const good={
  StackName:'precis-staging-iam-readonly',
  ChangeSetName:'appfactory-precis-staging-4832',
  Status:'CREATE_COMPLETE',ExecutionStatus:'AVAILABLE',
  ChangeSetType:'CREATE',
  Changes:[{ResourceChange:{
    Action:'Add',LogicalResourceId:'PrecisStagingFreePlanReadRole',
    ResourceType:'AWS::IAM::Role',Replacement:'False'
  }}]
};
test('central bootstrap isolates immutable AppFactory OIDC trust and IAM-only privilege',()=>{
  assert.match(central,/repo:EagleFox31@86088743\/appfactory-project-automation@1355997933:environment:staging/);
  assert.match(central,/arn:\$\{AWS::Partition\}:cloudformation:eu-west-3:/);
  assert.match(central,/appfactory-staging-iam-cfn-execution/);
  assert.match(central,/AppFactoryProject/);
  assert.match(central,/AppFactoryEnvironment/);
  assert.match(central,/iam:PermissionsBoundary/);
  assert.match(central,/freetier:GetAccountPlanState/);
  assert.doesNotMatch(central,/AWS::EC2::|AWS::SSM::|AWS::RDS::|AWS::S3::|iam:\*|Action:\s*'\*'/);
  assert.doesNotMatch(central,/AdministratorAccess|PowerUserAccess|AmazonEC2FullAccess/);
});
test('workflow defaults to audit and requires explicit approval for write operations',()=>{
  assert.match(workflow,/workflow_dispatch:/);
  assert.match(workflow,/type: boolean\s+default: false/);
  assert.match(workflow,/environment: staging/);
  assert.match(workflow,/PRECIS_REVIEWED_SHA: efa3f3492abca331453d9f814cc3e6269fbf6d79/);
  assert.ok(workflow.includes('ref: ${{ env.PRECIS_REVIEWED_SHA }}'));
  assert.doesNotMatch(workflow,/inputs\\.consumer_sha|^\\s+consumer_sha:/m);
  assert.match(workflow,/APPLY_PRECIS_STAGING_READER/);
  assert.match(workflow,/if: \$\{\{ inputs.apply \}\}/);
  assert.match(workflow,/if: \$\{\{ !inputs.apply \}\}/);
  assert.match(workflow,/verify-aws-free-plan\.mjs/);
  assert.match(workflow,/inspect-precis-staging-iam-template\.mjs/);
  assert.match(workflow,/inspect-precis-staging-iam-changeset\.mjs/);
  assert.match(workflow,/\$GITHUB_REF.*refs\/heads\/main/);
  assert.doesNotMatch(workflow,/aws ssm send-command|aws ec2 run-instances|AWS_ACCESS_KEY_ID/);
});
test('change-set validator accepts one narrowly scoped IAM role creation',()=>{
  const result=evaluateChangeSet(good);
  assert.equal(result.status,0,result.stderr);
});
test('change-set validator fails closed on updates and extra resources',()=>{
  for(const variant of [
    {...good,StackName:'atelier-maitre-prod'},
    {...good,ChangeSetName:'other-run'},
    {...good,Status:'FAILED'},
    {...good,ExecutionStatus:'OBSOLETE'},
    {...good,ChangeSetType:'UPDATE'},
    {...good,Changes:[...good.Changes,{ResourceChange:{Action:'Add',ResourceType:'AWS::EC2::Instance',LogicalResourceId:'x'}}]},
    {...good,Changes:[{ResourceChange:{...good.Changes[0].ResourceChange,Action:'Remove'}}]},
    {...good,Changes:[{ResourceChange:{...good.Changes[0].ResourceChange,ResourceType:'AWS::IAM::Policy'}}]},
    {...good,Changes:[]}
  ]) {
    const result=evaluateChangeSet(variant);
    assert.notEqual(result.status,0,JSON.stringify(variant));
  }
});
