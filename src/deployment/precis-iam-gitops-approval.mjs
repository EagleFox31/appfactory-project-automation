// Exact, short-lived, one-shot approval for Précis staging IAM reader only.
// A reviewed Git PR changes one dedicated JSON approval marker. That change
// dispatches an existing guarded manual workflow; it never deploys directly.
const FILE='infra/aws/approvals/precis-staging-iam-reader.json';
export const PRECIS_IAM_APPROVAL_FILE=FILE;

const expected={
  decision:'APPROVE_CREATE_ONLY',
  account:'458018461157',
  repository:'EagleFox31/Pr-cis-Translation',
  stack:'precis-staging-iam-readonly',
  iamRole:'precis-translation-staging-free-plan-read',
  consumerSha:'18618e5ca8b76a3a6b62278e16e0c6fd2fd078fd',
  templateGitBlob:'996be22806afb8fc1eecc11432d8b9ac64548dd2',
  approvedBy:'EagleFox31'
};

export function validatePrecisIamApproval({
  approval,actor,repository,ref,event,changedPaths,now=new Date()
}) {
  const deny=s=>{throw new Error('Précis IAM GitOps approval refused: '+s)};
  if(repository!=='EagleFox31/appfactory-project-automation' ||
     actor!=='EagleFox31' || ref!=='refs/heads/main' || event!=='push')
    deny('not a trusted owner-origin main branch push');
  if(!Array.isArray(changedPaths)||changedPaths.length!==1||changedPaths[0]!==FILE)
    deny('approval marker must be the only changed file in pushed main-range');
  if(!approval||typeof approval!=='object'||Array.isArray(approval))
    deny('approval manifest missing');
  const keys=Object.keys(expected).concat('approvedAt','expiresAt').sort();
  if(JSON.stringify(Object.keys(approval).sort())!==JSON.stringify(keys))
    deny('unknown or missing approval keys');
  for(const [key,val] of Object.entries(expected)) if(approval[key]!==val)
    deny('approval mismatch for '+key);
  const approved=Date.parse(approval.approvedAt);
  const expires=Date.parse(approval.expiresAt);
  const time=new Date(now).getTime();
  if(!Number.isFinite(approved)||!Number.isFinite(expires)||!Number.isFinite(time))
    deny('invalid approval timing');
  if(!/Z$/.test(approval.approvedAt)||!/Z$/.test(approval.expiresAt))
    deny('approval must use UTC timestamps');
  if(approved>time+300000 || expires<=time || expires<=approved ||
     expires-approved>24*3600*1000)
    deny('approval must be current and no longer than 24 hours');
  return {
    approved:true,
    exactChange:FILE,
    approvedBy:actor,
    tenant:approval.repository,
    stack:approval.stack,
    iamRole:approval.iamRole
  };
}
