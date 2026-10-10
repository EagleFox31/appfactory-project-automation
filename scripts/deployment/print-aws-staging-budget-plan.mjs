#!/usr/bin/env node
// Read-only disposable staging budget report. Does not create/upgrade
// infrastructure, assume EC2 permissions or enable apply.
import {readFile,appendFile} from 'node:fs/promises';
import {join} from 'node:path';
import {estimateStagingBudget,verifyAwsFreePlanForBudget} from '../../src/deployment/aws-staging-budget-gate.mjs';
const stop=(s)=>{throw new Error('AWS staging budget plan: '+s)};
if(process.env.GITHUB_ACTIONS!=='true' ||
   process.env.GITHUB_REPOSITORY!=='EagleFox31/appfactory-project-automation' ||
   process.env.GITHUB_REF!=='refs/heads/main' ||
   !['push','workflow_dispatch'].includes(process.env.GITHUB_EVENT_NAME))stop('untrusted CI context');
const dir=process.env.RUNNER_TEMP;
if(!dir)stop('runner temp missing');
const [identity,accountPlan,manifest]=await Promise.all([
  readFile(join(dir,'appfactory-ec2-plan-sts.json'),'utf8').then(JSON.parse),
  readFile(join(dir,'appfactory-ec2-plan-credits.json'),'utf8').then(JSON.parse),
  readFile(new URL('../../infra/aws/consumers/precis-staging.json',import.meta.url),'utf8').then(JSON.parse)
]);
const now=new Date();
const expiresAt=new Date(now.getTime()+167*3600000).toISOString();
const estimate=estimateStagingBudget({manifest,expiresAt,now});
const credit=verifyAwsFreePlanForBudget({identity,accountPlan,estimate,now});
const lines=[
  '### RAIDER — Précis disposable staging cost plan (NOT deployment)',
  '- Account: 4580******** — Free Plan ACTIVE, read directly from AWS.',
  '- Estimate duration: '+estimate.lifetimeHours.toFixed(1)+' hours, deadline '+expiresAt+'.',
  '- Selected 2vCPU/4GiB host: '+estimate.instanceType+', 40 GiB gp3 encrypted.',
  '- Compute list-price projection: $'+estimate.computeUsd.toFixed(2)+'.',
  '- IPv4 list-price projection: $'+estimate.ipv4Usd.toFixed(2)+'.',
  '- Conservative gp3 provisioning projection: $'+estimate.storageUsd.toFixed(2)+'.',
  '- Network, log and snapshot reserve: $'+estimate.variableReserveUsd.toFixed(2)+'.',
  '- Estimated **upper planning allowance (includes 25% cushion)**: $'+estimate.estimatedCeilingUsd.toFixed(2)+' / $'+estimate.maximumPolicyUsd+'.',
  '- AWS credits remaining at check: $'+credit.creditsUsd.toFixed(2)+'; projected reserve after staging: $'+credit.projectedCreditsAfter.toFixed(2)+'.',
  '- This is NOT a binding AWS price quote or a guarantee that all services are credit eligible.',
  '- No network/subnet/AMI IDs were discovered or assumed. No EC2/IAM/SSM writes performed.',
  '- **Deployment remains blocked until compute provisioner, backup test and cost eligibility are independently verified.**',''
].join('\n');
console.log(lines);
if(process.env.GITHUB_STEP_SUMMARY)await appendFile(process.env.GITHUB_STEP_SUMMARY,lines);
