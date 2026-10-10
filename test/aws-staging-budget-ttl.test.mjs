import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {estimateStagingBudget,verifyAwsFreePlanForBudget} from '../src/deployment/aws-staging-budget-gate.mjs';

const manifest=JSON.parse(readFileSync(new URL('../infra/aws/consumers/precis-staging.json',import.meta.url)));
const now=new Date('2026-10-10T10:00:00Z');
const after7='2026-10-17T10:00:00Z';
const plan={
  accountPlanType:'FREE',accountPlanStatus:'ACTIVE',
  accountPlanExpirationDate:'2027-03-15T00:00:00Z',
  accountPlanRemainingCredits:{amount:128.82,unit:'USD'}
};
const estimate=()=>estimateStagingBudget({manifest,now,expiresAt:after7});
test('RAIDER staging pilot plan stays under USD 35 for 7 days',()=>{
  const e=estimate();
  assert.equal(e.lifetimeHours,168);
  assert.ok(e.estimatedCeilingUsd<35);
  assert.equal(e.computeUsd,168*0.1117);
  assert.equal(e.realPricingVerified,false);
  assert.equal(e.estimatedServiceEligibleForCredits,false);
});
test('rejects paid plan, unexpected account, credit depletion and impending expiration',()=>{
  const e=estimate();
  for(const bad of [
    {accountPlan:{...plan,accountPlanType:'PAID'}},
    {accountPlan:{...plan,accountPlanStatus:'EXPIRED'}},
    {accountPlan:{...plan,accountPlanRemainingCredits:{amount:60,unit:'USD'}}},
    {accountPlan:{...plan,accountPlanExpirationDate:'2026-10-17T00:00:00Z'}},
    {identity:{Account:'000000000000'}}
  ]) assert.throws(()=>verifyAwsFreePlanForBudget({
    identity:{Account:'458018461157'},accountPlan:plan,estimate:e,now,...bad}));
  const ok=verifyAwsFreePlanForBudget({identity:{Account:'458018461157'},accountPlan:plan,estimate:e,now});
  assert.equal(ok.checked,true);
});
test('rejects excessive TTL, wrong sizing, exposed ingress, mutated lifecycle',()=>{
  for(const changes of [
    {expiresAt:'2026-10-18T11:00:00Z'},
    {expiresAt:'2026-10-10T08:00:00Z'},
    {expiresAt:'2026-10-17T10:00:00+00:00'},
    {manifest:{...manifest,lifecycle:'APPLY'}},
    {manifest:{...manifest,host:{...manifest.host,instanceType:'m7i.48xlarge'}}},
    {manifest:{...manifest,host:{...manifest.host,inboundTcpPorts:[22]}}},
    {manifest:{...manifest,host:{...manifest.host,rootVolumeGiB:300}}},
    {manifest:{...manifest,safety:{...manifest.safety,safeToApply:true}}}
  ])assert.throws(()=>estimateStagingBudget({manifest,now,expiresAt:after7,...changes}));
});
test('CloudFormation adds a bounded one-shot stack cleanup and disables surplus CPU charges',()=>{
  const t=readFileSync(new URL('../infra/aws/blueprints/reusable-compose-staging-host.yml',import.meta.url),'utf8');
  assert.match(t,/AWS::Scheduler::Schedule/);
  assert.match(t,/ScheduleExpression: !Sub 'at\(\$\{ExpiresAtUtc\}\)'/);
  assert.match(t,/ActionAfterCompletion: DELETE/);
  assert.match(t,/cloudformation:DeleteStack/);
  assert.match(t,/Resource: !Sub 'arn:\$\{AWS::Partition\}:cloudformation:\$\{AWS::Region\}:\$\{AWS::AccountId\}:stack\/\$\{AWS::StackName\}\/\*'/);
  assert.match(t,/PermissionsBoundary: !Ref TtlSchedulerRoleBoundaryArn/);
  assert.match(t,/CPUCredits: standard/);
  assert.match(t,/DeleteOnTermination: true/);
});
