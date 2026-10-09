// Runner-side transport coordinator for an *approved* staging invocation.
// AWS SDK operations are injected. This module does not execute on import.
import {validateSsmInvocationTarget,verifySsmSendReceipt} from './ssm-invocation-guard.mjs';
import {waitForSsmInvocation} from './ssm-gateway-polling.mjs';

const SOURCE=/^[a-f0-9]{40}$/;
const ACCOUNT=/^\d{12}$/;
const INSTANCE=/^i-[a-f0-9]{8}(?:[a-f0-9]{9})?$/;
const DOCUMENT=/^AppFactory-Staging-Rollout-[A-Za-z0-9-]{1,64}$/;
const PAYLOAD_SHA=/^[a-f0-9]{64}$/;
function insist(value,message){if(!value)throw new Error('SSM gateway: '+message);}
function exactFields(obj,fields,label) {
  insist(obj && typeof obj==='object' && !Array.isArray(obj),label+' must be object');
  insist(Object.keys(obj).sort().join('|')===fields.slice().sort().join('|'),label+' contains unexpected fields');
}
export function verifyStagingAuthorization({approval,binding,proof}) {
  exactFields(approval,['approved','environment','repository','sourceSha','instanceId','awsAccount','documentName','payloadSha256'],'approval');
  exactFields(binding,['repository','environment','sourceSha','instanceId','awsAccount','documentName','payloadSha256'],'binding');
  insist(approval.approved===true,'explicit staging approval required');
  insist(approval.environment==='staging' && binding.environment==='staging','only staging execution is permitted');
  insist(typeof binding.repository==='string' && /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(binding.repository),'invalid repo');
  insist(SOURCE.test(binding.sourceSha),'invalid source commit');
  insist(INSTANCE.test(binding.instanceId),'invalid EC2 instance ID');
  insist(ACCOUNT.test(binding.awsAccount),'invalid account');
  insist(DOCUMENT.test(binding.documentName),'unapproved SSM document');
  insist(PAYLOAD_SHA.test(binding.payloadSha256),'invalid payload digest');
  for(const key of ['environment','repository','sourceSha','instanceId','awsAccount','documentName','payloadSha256'])
    insist(approval[key]===binding[key],'approval mismatch: '+key);
  insist(proof?.verified===true && proof?.repository===binding.repository &&
    proof?.sourceSha===binding.sourceSha && proof?.environment===binding.environment &&
    proof?.instanceId===binding.instanceId && proof?.awsAccount===binding.awsAccount &&
    proof?.payloadSha256===binding.payloadSha256,
    'fresh trusted provenance and target proof required');
  return true;
}

// The caller must obtain approval and proof from independent trusted sources:
// GitHub protected-environment approval, verified release history and fresh AWS identity.
// No user-provided JSON is independently sufficient for deployment authorization.
export async function dispatchApprovedStagingRollout({
 approval,binding,proof,sendCommand,getInvocation,now,sleep,timeoutMs=180000,pollMs=3000
}) {
  verifyStagingAuthorization({approval,binding,proof});
  insist(typeof sendCommand==='function' && typeof getInvocation==='function','AWS adapters required');
  // Custom SSM document only. The document must fetch an immutable, validated
  // host payload by digest and call the pinned host executor without shell interpolation.
  // No AWS-RunShellScript or user supplied commands/Parameters accepted here.
  const send=await sendCommand({
    DocumentName:binding.documentName,
    InstanceIds:[binding.instanceId],
    MaxConcurrency:'1',
    MaxErrors:'0',
    Parameters:{payloadSha256:[binding.payloadSha256]},
    Comment:'AppFactory approved staging '+binding.sourceSha
  });
  const commandId=send?.Command?.CommandId;
  const target=validateSsmInvocationTarget({commandId,instanceId:binding.instanceId});
  verifySsmSendReceipt(send,target);
  const result=await waitForSsmInvocation({target,getInvocation,now,sleep,timeoutMs,pollMs});
  return {commandId,instanceId:binding.instanceId,status:result.status,attempts:result.attempts};
}
