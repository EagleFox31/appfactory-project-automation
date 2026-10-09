import test from 'node:test';
import assert from 'node:assert/strict';
import {validateSsmInvocationTarget,verifySsmSendReceipt,classifySsmInvocation} from '../src/deployment/ssm-invocation-guard.mjs';
const target={commandId:'12345678-1234-1234-1234-123456789abc',instanceId:'i-0123456789abcdef0'};
const receipt={Command:{CommandId:target.commandId,InstanceIds:[target.instanceId],MaxConcurrency:'1'}};
const invocation=(status,code)=>({CommandId:target.commandId,InstanceId:target.instanceId,StatusDetails:status,ResponseCode:code});
test('accepts only well-formed command and instance identities',()=>{
  assert.deepEqual(validateSsmInvocationTarget(target),target);
  for(const change of [{commandId:'bad;echo pwned'},{instanceId:'i-other'},{instanceId:'*'}])
    assert.throws(()=>validateSsmInvocationTarget({...target,...change}));
});
test('receipt must target exactly the declared instance',()=>{
  assert.equal(verifySsmSendReceipt(receipt,target),true);
  for(const change of [{InstanceIds:[]},{InstanceIds:[target.instanceId,'i-abcdefabcdefabcde']},{Targets:[{Key:'tag:Name',Values:['all']}]},{MaxConcurrency:'100%'}])
    assert.throws(()=>verifySsmSendReceipt({Command:{...receipt.Command,...change}},target));
});
test('success requires matching invocation identity and exit code zero',()=>{
  assert.deepEqual(classifySsmInvocation(invocation('Success',0),target),{state:'success',status:'Success'});
  for(const code of [1,-1,undefined])assert.throws(()=>classifySsmInvocation(invocation('Success',code),target));
  assert.throws(()=>classifySsmInvocation({...invocation('Success',0),InstanceId:'i-abcdefabcdefabcde'},target));
  assert.throws(()=>classifySsmInvocation({...invocation('Success',0),CommandId:'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'},target));
});
test('all known failures fail closed and progress is not success',()=>{
  for(const status of ['Failed','Cancelled','TimedOut','Delivery Timed Out','Execution Timed Out','Undeliverable','Terminated','InvalidPlatform','AccessDenied'])
    assert.equal(classifySsmInvocation(invocation(status,-1),target).state,'failure');
  for(const status of ['Pending','InProgress','Delayed','Cancelling'])
    assert.equal(classifySsmInvocation(invocation(status,-1),target).state,'pending');
  assert.throws(()=>classifySsmInvocation(invocation('Unexpected',0),target));
});
