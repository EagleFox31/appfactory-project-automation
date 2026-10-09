import test from 'node:test';
import assert from 'node:assert/strict';
import {
  evaluateAwsProvisionerReadiness,CFN_ACTIONS,TARGET_IAM_ACTIONS
} from '../src/deployment/aws-provisioner-readiness.mjs';

const account='458018461157';
const runnerRoleArn='arn:aws:iam::'+account+':role/appfactory-staging-onboarding-runner';
const serviceRoleArn='arn:aws:iam::'+account+':role/appfactory-staging-cloudformation-executor';
const targetRoleArn='arn:aws:iam::'+account+':role/precis-translation-staging-free-plan-read';
const stackArn='arn:aws:cloudformation:eu-west-3:'+account+':stack/precis-translation-staging-iam/*';
const inspected=(arn,trust)=>({Role:{
  Arn:arn,RoleName:arn.split('/').at(-1),
  AssumeRolePolicyDocument:trust||{Statement:[]}
}});
const trust={Statement:[{
  Effect:'Allow',Action:'sts:AssumeRole',
  Principal:{Service:'cloudformation.amazonaws.com'}
}]};
const simulated=(actions,resource)=>({EvaluationResults:actions.map(action=>({
  EvalActionName:action,EvalResourceName:resource,
  EvalDecision:'allowed',MissingContextValues:[]
}))});
const input={
  expectedAccount:account,
  targetRepository:'EagleFox31/Pr-cis-Translation',
  stackArn,targetRoleArn,runnerRoleArn,serviceRoleArn,
  sts:{Account:account},
  runnerRole:inspected(runnerRoleArn),
  serviceRole:inspected(serviceRoleArn,trust),
  cloudFormationSimulation:simulated(CFN_ACTIONS,stackArn),
  passRoleSimulation:simulated(['iam:PassRole'],serviceRoleArn),
  iamRoleSimulation:simulated(TARGET_IAM_ACTIONS,targetRoleArn)
};
const check=(delta={})=>evaluateAwsProvisionerReadiness({...structuredClone(input),...delta});
test('complete separate-role simulation yields only advisory readiness',()=>{
  const result=check();
  assert.equal(result.readyForProtectedApproval,true);
  assert.equal(result.advisoryOnly,true);
  assert.match(result.warning,/advisory/);
});
test('rejects Atelier production and administrator identities',()=>{
  for(const delta of [
    {targetRepository:'EagleFox31/atelier2026'},
    {runnerRoleArn:'arn:aws:iam::'+account+':role/atelier-maitre-prod'},
    {serviceRoleArn:'arn:aws:iam::'+account+':role/AdministratorAccess'},
    {targetRoleArn:runnerRoleArn},
    {targetRoleArn:'arn:aws:iam::000000000000:role/staging-test'}
  ])assert.throws(()=>check(delta));
});
test('rejects wrong account and cross-tenant stack namespace',()=>{
  for(const delta of [
    {sts:{Account:'000000000000'}},
    {stackArn:'arn:aws:cloudformation:eu-west-3:'+account+':stack/atelier-maitre-prod/*'},
    {stackArn:'arn:aws:cloudformation:eu-west-3:000000000000:stack/precis-translation-staging-iam/*'}
  ])assert.throws(()=>check(delta));
});
test('rejects missing role proof and unsafe service trust',()=>{
  assert.throws(()=>check({runnerRole:null}));
  assert.throws(()=>check({serviceRole:inspected(serviceRoleArn)}));
  assert.throws(()=>check({serviceRole:inspected(serviceRoleArn,{Statement:[]})}));
});
test('rejects implicit deny, context omissions and simulation result substitutions',()=>{
  const denial=simulated(CFN_ACTIONS,stackArn);
  denial.EvaluationResults[1].EvalDecision='implicitDeny';
  assert.throws(()=>check({cloudFormationSimulation:denial}));
  const badContext=simulated(['iam:PassRole'],serviceRoleArn);
  badContext.EvaluationResults[0].MissingContextValues=['iam:PassedToService'];
  assert.throws(()=>check({passRoleSimulation:badContext}));
  const wrongResource=simulated(TARGET_IAM_ACTIONS,runnerRoleArn);
  assert.throws(()=>check({iamRoleSimulation:wrongResource}));
  const duplicates=simulated(TARGET_IAM_ACTIONS,targetRoleArn);
  duplicates.EvaluationResults[0].EvalActionName=duplicates.EvaluationResults[1].EvalActionName;
  assert.throws(()=>check({iamRoleSimulation:duplicates}));
  assert.throws(()=>check({iamRoleSimulation:null}));
});
