// Strict interpretation of AWS SSM Run Command results.
// Pure validation only: this module never starts a command or contacts AWS.
const HEX_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const INSTANCE = /^i-[0-9a-f]{8}(?:[0-9a-f]{9})?$/;
const SUCCESS = 'Success';
const TERMINAL_FAILURES = new Set(['Failed','Cancelled','TimedOut','Delivery Timed Out','Execution Timed Out','Undeliverable','Terminated','InvalidPlatform','AccessDenied']);
const NONTERMINAL = new Set(['Pending','InProgress','Delayed','Cancelling']);
function requireSafe(value, pattern, label) {
  if (typeof value !== 'string' || !pattern.test(value)) throw new Error('SSM '+label+' is invalid');
  return value;
}
export function validateSsmInvocationTarget({commandId,instanceId}) {
  return {
    commandId: requireSafe(commandId,HEX_UUID,'command ID'),
    instanceId: requireSafe(instanceId,INSTANCE,'instance ID')
  };
}
// Accept only the single intended EC2 target, not aggregate counts from a broad SendCommand.
export function verifySsmSendReceipt(receipt,target) {
  const expected=validateSsmInvocationTarget(target);
  const cmd=receipt?.Command;
  if (!cmd || cmd.CommandId!==expected.commandId) throw new Error('SSM send receipt command mismatch');
  if (!Array.isArray(cmd.InstanceIds) || cmd.InstanceIds.length!==1 || cmd.InstanceIds[0]!==expected.instanceId)
    throw new Error('SSM send receipt target mismatch');
  if (cmd.Targets?.length || cmd.TargetLocations?.length) throw new Error('SSM broad targeting is prohibited');
  if (cmd.MaxConcurrency!=null && String(cmd.MaxConcurrency)!=='1') throw new Error('SSM concurrency must be one');
  return true;
}
export function classifySsmInvocation(invocation,target) {
  const expected=validateSsmInvocationTarget(target);
  if (!invocation || invocation.CommandId!==expected.commandId || invocation.InstanceId!==expected.instanceId)
    throw new Error('SSM invocation identity mismatch');
  const status=invocation.StatusDetails || invocation.Status;
  if (status===SUCCESS) {
    if (invocation.ResponseCode!==0) throw new Error('SSM success reported with nonzero or missing exit code');
    return {state:'success',status};
  }
  if (TERMINAL_FAILURES.has(status)) return {state:'failure',status};
  if (NONTERMINAL.has(status)) return {state:'pending',status};
  throw new Error('Unknown SSM invocation status: '+String(status));
}
