import test from 'node:test';
import assert from 'node:assert/strict';
import {waitForSsmInvocation} from '../src/deployment/ssm-gateway-polling.mjs';
const target={commandId:'12345678-1234-1234-1234-123456789abc',instanceId:'i-0123456789abcdef0'};
const response=(status,code=0)=>({CommandId:target.commandId,InstanceId:target.instanceId,StatusDetails:status,ResponseCode:code});
const clock=()=>{let time=0;return {now:()=>time,sleep:async ms=>{time+=ms;}}};
test('polls only the verified invocation until exit zero',async()=>{
 const c=clock(), statuses=[response('InProgress'),response('Success')];
 const result=await waitForSsmInvocation({target,getInvocation:async t=>{assert.deepEqual(t,target);return statuses.shift();},...c});
 assert.deepEqual(result,{status:'Success',attempts:2});
});
test('fails on wrong target or unsuccessful exit code',async()=>{
 for(const bad of [{...response('Success'),InstanceId:'i-abcdefabcdefabcde'},response('Success',12)]) {
  const c=clock();
  await assert.rejects(waitForSsmInvocation({target,getInvocation:async()=>bad,...c}));
 }
});
test('fails on explicit terminal error without retrying',async()=>{
 const c=clock();let count=0;
 await assert.rejects(waitForSsmInvocation({target,getInvocation:async()=>{count++;return response('Failed',1);},...c}),/command failed/);
 assert.equal(count,1);
});
test('enforces finite deadline with controlled polling',async()=>{
 const c=clock();
 await assert.rejects(waitForSsmInvocation({target,getInvocation:async()=>response('Pending',-1),timeoutMs:1000,pollMs:200,...c}),/deadline exceeded/);
});
test('only InvocationDoesNotExist is retried',async()=>{
 const c=clock();let count=0;
 const result=await waitForSsmInvocation({target,getInvocation:async()=>{if(!count++)throw Object.assign(new Error('not yet propagated'),{name:'InvocationDoesNotExist'});return response('Success');},...c});
 assert.equal(result.attempts,2);
 await assert.rejects(waitForSsmInvocation({target,getInvocation:async()=>{throw Object.assign(new Error('denied'),{name:'AccessDeniedException'});},...clock()}),/denied/);
});
test('rejects invalid time bounds before contacting AWS',async()=>{
 for(const timeoutMs of [0,-1,999,900001,Infinity])await assert.rejects(waitForSsmInvocation({target,getInvocation:async()=>response('Success'),timeoutMs,...clock()}));
});
