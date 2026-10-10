// RAIDER deterministic disposable AWS staging cost policy. Prices are
// conservative planning inputs, NOT AWS Pricing API quotations.
const SUPPORTED=new Map([['eu-west-3:t3.medium',0.0472]]);
const HOURS=168;
const MAX_ESTIMATE_USD=18;
const MIN_CREDITS_RESERVE_USD=75;
const STORAGE_GIB_MONTH_UPPER=0.14;
const PUBLIC_IPV4_HOUR=0.005;
const VARIABLE_OPERATIONS_RESERVE=3;
const MAX_VOLUME=40;
const SLUG=/^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/;
const fail=s=>{throw new Error('Staging cost gate: '+s);};

export function estimateStagingBudget({manifest,expiresAt,now=new Date()}) {
  if(manifest?.contractVersion!==1||manifest?.provider!=='aws'||manifest?.environment!=='staging'||
     !SLUG.test(manifest.project??'')||manifest?.lifecycle!=='PLAN_ONLY')
    fail('approved declarative, plan-only AWS staging manifest required');
  const {instanceType,rootVolumeGiB}=manifest.host||{};
  const hourRate=SUPPORTED.get(manifest.region+':'+instanceType);
  if(!hourRate)fail('instance rate and region not independently reviewed');
  if(!Number.isInteger(rootVolumeGiB)||rootVolumeGiB<30||rootVolumeGiB>MAX_VOLUME)
    fail('volume is out of reviewed range');
  if(manifest.host.publicIpv4ForOutboundOnly!==true||
    JSON.stringify(manifest.host.inboundTcpPorts)!=='[]')
    fail('isolated outbound-only host is required');
  if(manifest.safety?.safeToApply!==false||manifest.safety?.awsStackAuthorizedForApply!==false)
    fail('unapproved manifest must never represent an apply authorization');
  const time=Date.parse(expiresAt),start=new Date(now).getTime();
  const lifetimeHours=(time-start)/3600000;
  if(!Number.isFinite(time)||!Number.isFinite(start)||lifetimeHours<1||lifetimeHours>HOURS)
    fail('expiration must be within 1..168 hours of the present');
  if(typeof expiresAt!=='string'||!/Z$/.test(expiresAt))
    fail('expiration must use explicit UTC Z notation');
  const computeUsd=lifetimeHours*hourRate;
  const ipv4Usd=lifetimeHours*PUBLIC_IPV4_HOUR;
  // EBS billing persists for every allocated GiB throughout staging life.
  const storageUsd=rootVolumeGiB*STORAGE_GIB_MONTH_UPPER*lifetimeHours/730;
  const subtotal=computeUsd+ipv4Usd+storageUsd+VARIABLE_OPERATIONS_RESERVE;
  const estimatedCeilingUsd=Math.ceil(subtotal*1.25*100)/100;
  if(estimatedCeilingUsd>MAX_ESTIMATE_USD)fail('estimated ceiling exceeds authorized pilot limit');
  return {lifetimeHours,computeUsd,ipv4Usd,storageUsd,
    variableReserveUsd:VARIABLE_OPERATIONS_RESERVE,estimatedCeilingUsd,
    maximumPolicyUsd:MAX_ESTIMATE_USD,minimumCreditReserveUsd:MIN_CREDITS_RESERVE_USD,
    estimatedServiceEligibleForCredits:false,realPricingVerified:false,
    currency:'USD',region:manifest.region,instanceType,rootVolumeGiB};
}

export function verifyAwsFreePlanForBudget({identity,accountPlan,estimate,now=new Date()}) {
  if(identity?.Account!=='458018461157')fail('incorrect AWS account');
  if(accountPlan?.accountPlanType!=='FREE'||accountPlan?.accountPlanStatus!=='ACTIVE')
    fail('AWS account must remain on Free / Active plan');
  const balance=accountPlan?.accountPlanRemainingCredits?.amount;
  const unit=accountPlan?.accountPlanRemainingCredits?.unit;
  if(!Number.isFinite(balance)||balance<0||unit!=='USD')fail('invalid AWS credit balance');
  const expiration=Date.parse(accountPlan.accountPlanExpirationDate);
  const minDays=Math.ceil(estimate.lifetimeHours/24)+2;
  if(!Number.isFinite(expiration)||(expiration-new Date(now).getTime())/86400000<minDays)
    fail('Free Plan expires before cleanup plus safety buffer');
  if(balance-estimate.estimatedCeilingUsd<MIN_CREDITS_RESERVE_USD)
    fail('credits after planned staging do not meet reserve');
  // This verifies budget feasibility ONLY. Must not be interpreted as
  // administrator IAM authorization, EC2 credit eligibility, or apply permission.
  return {checked:true,creditsUsd:balance,projectedCreditsAfter:balance-estimate.estimatedCeilingUsd};
}
