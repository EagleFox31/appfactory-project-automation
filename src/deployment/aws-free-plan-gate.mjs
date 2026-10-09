// Fail-closed, read-only Free Tier account guard for unprovisioned AWS staging.
// This is a *prerequisite*, not a guarantee that an EC2 resource has no cost.
const fail=(message)=>{throw new Error('AWS zero-out-of-pocket gate: '+message)};
export function validateFreePlanState({
  identity, plan, now=new Date(), minimumUsd=25, minimumDays=14
}) {
  if(!identity || typeof identity!=='object' || !/^\d{12}$/.test(identity.Account||''))
    fail('trusted STS account identity is missing');
  if(!plan || typeof plan!=='object')fail('Free Tier plan response is missing');
  if(plan.accountId!==identity.Account)fail('Free Tier and STS accounts do not match');
  if(plan.accountPlanType!=='FREE')fail('account is not on the no-charge Free Plan');
  if(plan.accountPlanStatus!=='ACTIVE')fail('Free Plan is not active');
  if(plan.accountPlanRemainingCredits?.unit!=='USD')fail('credit currency must be USD');
  const credits=plan.accountPlanRemainingCredits?.amount;
  if(typeof credits!=='number'||!Number.isFinite(credits)||credits<minimumUsd)
    fail('remaining promotional credits below approved safety threshold');
  if(!Number.isFinite(minimumUsd)||minimumUsd<1||minimumUsd>1000)
    fail('invalid minimum credit threshold');
  if(!Number.isInteger(minimumDays)||minimumDays<1||minimumDays>180)
    fail('invalid time safety threshold');
  const timestamp=new Date(now).getTime();
  const expiration=Date.parse(plan.accountPlanExpirationDate);
  if(!Number.isFinite(timestamp)||!Number.isFinite(expiration))
    fail('missing or invalid Free Plan expiration date');
  const daysRemaining=(expiration-timestamp)/86400000;
  if(daysRemaining<minimumDays)fail('Free Plan expires too soon');
  return {
    account:identity.Account,
    planType:plan.accountPlanType,
    status:plan.accountPlanStatus,
    creditsUsd:credits,
    daysRemaining:Math.floor(daysRemaining),
    assessedAt:new Date(timestamp).toISOString()
  };
}
