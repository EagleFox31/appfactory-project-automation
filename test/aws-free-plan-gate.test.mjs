import test from 'node:test';
import assert from 'node:assert/strict';
import {validateFreePlanState} from '../src/deployment/aws-free-plan-gate.mjs';

const now=new Date('2026-10-09T12:00:00Z');
const identity={Account:'123456789012'};
const state={
  accountId:'123456789012',
  accountPlanType:'FREE',
  accountPlanStatus:'ACTIVE',
  accountPlanRemainingCredits:{amount:100,unit:'USD'},
  accountPlanExpirationDate:'2026-12-09T00:00:00Z'
};
const check=(overrides={},ident=identity)=>validateFreePlanState({identity:ident,plan:{...state,...overrides},now});
test('allows only active matching Free Plan with sufficient credits and days',()=>{
  const result=check();
  assert.equal(result.planType,'FREE');
  assert.equal(result.creditsUsd,100);
  assert.ok(result.daysRemaining>=14);
});
test('rejects Paid Plan even if promotional credits remain',()=>{
  assert.throws(()=>check({accountPlanType:'PAID'}),/Free Plan/);
});
test('rejects expired/inactive plan, wrong account, low credits or stale expiry',()=>{
  for(const changed of [
    {accountPlanStatus:'EXPIRED'},
    {accountPlanStatus:'NOT_STARTED'},
    {accountId:'987654321012'},
    {accountPlanRemainingCredits:{amount:5,unit:'USD'}},
    {accountPlanRemainingCredits:{amount:30,unit:'EUR'}},
    {accountPlanRemainingCredits:{amount:NaN,unit:'USD'}},
    {accountPlanExpirationDate:'2026-10-10T00:00:00Z'},
    {accountPlanExpirationDate:'broken'},
    {accountPlanExpirationDate:undefined}
  ]) assert.throws(()=>check(changed));
  assert.throws(()=>check({}, {Account:'invalid'}));
});
test('fails shut on missing or malformed AWS output',()=>{
  assert.throws(()=>validateFreePlanState({identity,plan:null,now}));
  assert.throws(()=>validateFreePlanState({identity:null,plan:state,now}));
  assert.throws(()=>validateFreePlanState({identity,plan:state,now:'garbage'}));
  assert.throws(()=>validateFreePlanState({identity,plan:state,now,minimumUsd:-2}));
  assert.throws(()=>validateFreePlanState({identity,plan:state,now,minimumDays:0}));
});
