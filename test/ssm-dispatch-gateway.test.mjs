import test from 'node:test';
import assert from 'node:assert/strict';
import {verifyStagingAuthorization,dispatchApprovedStagingRollout} from '../src/deployment/ssm-dispatch-gateway.mjs';
const commandId='12345678-1234-1234-1234-123456789abc';
const binding={repository:'EagleFox31/Pr-cis-Translation',environment:'staging',sourceSha:'a'.repeat(40),instanceId:'i-0123456789abcdef0',awsAccount:'123456789012',documentName:'AppFactory-Staging-Rollout-Precis',payloadSha256:'b'.repeat(64)};
const approval={approved:true,...binding};
const proof={verified:true,...binding};
const receipt={Command:{CommandId:commandId,InstanceIds:[binding.instanceId],MaxConcurrency:'1'}};
test('correct staged approval and fresh proof pass',()=>assert.equal(verifyStagingAuthorization({approval,binding,proof}),true));
test('reject production, mismatched or incomplete authorization before AWS send',async()=>{
 for(const variant of [
 {approval:{...approval,environment:'production'}},
 {approval:{...approval,approved:false}},
 {approval:{...approval,instanceId:'i-abcdefabcdefabcde'}},
 {binding:{...binding,documentName:'AWS-RunShellScript'}},
 {proof:{...proof,verified:false}},
 {proof:{...proof,sourceSha:'c'.repeat(40)}},
 {approval:{...approval,arbitrary:true}}
 ]) {
  let called=false;
  await assert.rejects(dispatchApprovedStagingRollout({approval,binding,proof,...variant,sendCommand:async()=>{called=true;return receipt},getInvocation:async()=>({})}));
  assert.equal(called,false);
 }
});
test('dispatch targets exactly one instance and consumes zero-exit SSM result',async()=>{
 const out=await dispatchApprovedStagingRollout({approval,binding,proof,
  sendCommand:async req=>{assert.equal(req.DocumentName,binding.documentName);assert.deepEqual(req.InstanceIds,[binding.instanceId]);assert.deepEqual(req.Parameters,{payloadSha256:[binding.payloadSha256]});return receipt;},
  getInvocation:async()=>({CommandId:commandId,InstanceId:binding.instanceId,StatusDetails:'Success',ResponseCode:0})
 });
 assert.equal(out.status,'Success');
});
test('reject broad send receipt and failed remote execution',async()=>{
 const common={approval,binding,proof,getInvocation:async()=>({CommandId:commandId,InstanceId:binding.instanceId,StatusDetails:'Failed',ResponseCode:1})};
 await assert.rejects(dispatchApprovedStagingRollout({...common,sendCommand:async()=>({Command:{...receipt.Command,InstanceIds:[binding.instanceId,'i-abcdefabcdefabcde']}})}),/target mismatch/);
 await assert.rejects(dispatchApprovedStagingRollout({...common,sendCommand:async()=>receipt}),/command failed/);
});
