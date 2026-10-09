#!/usr/bin/env node
// GitHub Actions AWS Free Plan verification triggered by main branch pushes.
// Never creates resources, changes IAM, or issues SSM commands.
import {readFile,appendFile} from 'node:fs/promises';
import {join} from 'node:path';
import {validateFreePlanState} from '../../src/deployment/aws-free-plan-gate.mjs';

const deny=reason=>{throw new Error('Automated AWS staging preflight: '+reason)};
if(process.env.GITHUB_ACTIONS!=='true')deny('GitHub Actions required');
if(!['push','workflow_dispatch'].includes(process.env.GITHUB_EVENT_NAME))deny('untrusted event');
if(process.env.GITHUB_REF!=='refs/heads/main')deny('must run on main');
if(process.env.GITHUB_REPOSITORY!=='EagleFox31/appfactory-project-automation')deny('wrong repo');
const dir=process.env.RUNNER_TEMP;
if(!dir)deny('runner temp missing');
const [identity,plan]=await Promise.all([
  'appfactory-auto-sts.json','appfactory-auto-freetier.json'
].map(p=>readFile(join(dir,p),'utf8').then(JSON.parse)));
const checked=validateFreePlanState({identity,plan,minimumUsd:25,minimumDays:14});
if(checked.account!=='458018461157')deny('wrong Trigenys AWS account');
const summary=[
  '### AppFactory — AWS staging Free Plan preflight (automatic)',
  '- Verified AWS account: 4580********',
  '- Plan: FREE / ACTIVE',
  '- Credits remaining: $'+checked.creditsUsd.toFixed(2)+' USD',
  '- Days until plan expiry: '+checked.daysRemaining,
  '- Scope: read-only STS and AWS Free Tier account inspection.',
  '- **No resources were created or modified.**',
  '- An IAM deployment still requires separate approval and safeguards.',
  ''
].join('\n');
console.log(summary);
if(process.env.GITHUB_STEP_SUMMARY)await appendFile(process.env.GITHUB_STEP_SUMMARY,summary);
