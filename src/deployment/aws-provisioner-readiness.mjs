// Read-only AWS delegated-provisioner capability assessment.
// IAM simulation provides *advisory* evidence, never authority to deploy.
const accountRe=/^\d{12}$/;
const roleRe=/^arn:aws:iam::(\d{12}):role\/[A-Za-z0-9+=,.@_/-]+$/;
const stackRe=/^arn:aws:cloudformation:([a-z]{2}-[a-z]+-\d+):(\d{12}):stack\/[a-z][a-z0-9-]+\/\*$/;
const bad=/atelier|prod(?:uction)?|administrator|poweruser|root/i;
const must=(ok,message)=>{if(!ok)throw new Error('AWS onboarding preflight: '+message);};

export const CFN_ACTIONS=Object.freeze([
  'cloudformation:CreateChangeSet',
  'cloudformation:DescribeChangeSet',
  'cloudformation:ExecuteChangeSet',
  'cloudformation:DeleteChangeSet',
  'cloudformation:DescribeStacks'
]);
export const TARGET_IAM_ACTIONS=Object.freeze([
  'iam:CreateRole','iam:PutRolePolicy','iam:GetRole'
]);

function checkRoleRole(resp,arn,label) {
  must(resp?.Role && resp.Role.Arn===arn,label+' must be a freshly inspected IAM role');
  must(resp.Role.RoleName===arn.split('/').at(-1),label+' role name mismatch');
}
function checkSim(sim,actions,resource,label) {
  must(Array.isArray(sim?.EvaluationResults),label+' IAM simulation missing');
  must(sim.EvaluationResults.length===actions.length,label+' IAM simulation size mismatch');
  const encountered=new Set();
  for(const entry of sim.EvaluationResults) {
    must(actions.includes(entry.EvalActionName),label+' unexpected action');
    must(!encountered.has(entry.EvalActionName),label+' duplicated action');
    encountered.add(entry.EvalActionName);
    must(entry.EvalResourceName===resource,label+' wrong resource');
    must(entry.EvalDecision==='allowed',label+' operation not allowed: '+entry.EvalActionName);
    must(Array.isArray(entry.MissingContextValues) && entry.MissingContextValues.length===0,
      label+' incomplete policy simulation context');
  }
}
function checkServiceTrust(role) {
  let doc=role?.Role?.AssumeRolePolicyDocument;
  // AWS sometimes returns decoded JSON and sometimes percent-encoded JSON.
  if(typeof doc==='string') {
    try{doc=JSON.parse(decodeURIComponent(doc));}catch{must(false,'service trust policy unparseable');}
  }
  const stmts=doc?.Statement;
  must(Array.isArray(stmts),'service role trust policy missing');
  must(stmts.some(s=>
    s?.Effect==='Allow' && s?.Action==='sts:AssumeRole' &&
    (s?.Principal?.Service==='cloudformation.amazonaws.com' ||
    (Array.isArray(s?.Principal?.Service)&&s.Principal.Service.includes('cloudformation.amazonaws.com')))),
  'service role must be assumed by CloudFormation');
}
export function evaluateAwsProvisionerReadiness({
  expectedAccount, targetRepository, stackArn, targetRoleArn,
  runnerRoleArn, serviceRoleArn, sts, runnerRole, serviceRole,
  cloudFormationSimulation, passRoleSimulation, iamRoleSimulation
}) {
  must(accountRe.test(expectedAccount||''),'expected account required');
  must(sts?.Account===expectedAccount,'STS account mismatch');
  must(typeof targetRepository==='string' && /^[A-Za-z0-9_-]+\/[A-Za-z0-9_.-]+$/.test(targetRepository),
    'invalid GitHub repository');
  must(targetRepository!=='EagleFox31/atelier2026','Atelier production excluded');
  must(roleRe.test(runnerRoleArn||'') && roleRe.test(serviceRoleArn||'') &&
    roleRe.test(targetRoleArn||''),'three exact role ARNs required');
  must([runnerRoleArn,serviceRoleArn,targetRoleArn].every(a=>a.split(':')[4]===expectedAccount),
    'cross-account role rejected');
  must(new Set([runnerRoleArn,serviceRoleArn,targetRoleArn]).size===3,'roles must be separated');
  must(!bad.test(runnerRoleArn) && !bad.test(serviceRoleArn) && !bad.test(targetRoleArn),
    'production or administrator role reuse forbidden');
  const match=stackRe.exec(stackArn||'');
  must(match && match[2]===expectedAccount,'dedicated stack resource pattern required');
  must(stackArn.includes(':stack/precis-translation-staging-') ||
    targetRepository!=='EagleFox31/Pr-cis-Translation',
    'Précis must have dedicated staging stack namespace');
  checkRoleRole(runnerRole,runnerRoleArn,'runner');
  checkRoleRole(serviceRole,serviceRoleArn,'CloudFormation service');
  checkServiceTrust(serviceRole);
  checkSim(cloudFormationSimulation,CFN_ACTIONS,stackArn,'CloudFormation');
  checkSim(passRoleSimulation,['iam:PassRole'],serviceRoleArn,'PassRole');
  checkSim(iamRoleSimulation,TARGET_IAM_ACTIONS,targetRoleArn,'tenant IAM');
  return Object.freeze({
    advisoryOnly:true,
    readyForProtectedApproval:true,
    account:expectedAccount,
    repository:targetRepository,
    stackArn, runnerRoleArn, serviceRoleArn,
    warning:'IAM simulation is advisory; no infrastructure or trust permission was exercised'
  });
}
