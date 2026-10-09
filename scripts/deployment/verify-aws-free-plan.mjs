#!/usr/bin/env node
import {readFile, appendFile} from 'node:fs/promises';
import {join} from 'node:path';
import {validateFreePlanState} from '../../src/deployment/aws-free-plan-gate.mjs';

if(process.env.GITHUB_ACTIONS!=='true'||process.env.GITHUB_EVENT_NAME!=='workflow_dispatch')
  throw new Error('AWS Free Plan preflight may run only by manual GitHub workflow_dispatch');
const directory=process.env.RUNNER_TEMP;
if(!directory)throw new Error('RUNNER_TEMP missing');
const [identity,plan]=await Promise.all([
  'appfactory-sts-identity.json','appfactory-free-plan-state.json'
].map(file=>readFile(join(directory,file),'utf8').then(JSON.parse)));
const checked=validateFreePlanState({identity,plan,minimumUsd:25,minimumDays:14});
const result=[
  '### AWS Free Plan safety gate — read-only PASS',
  '- AWS account: '+checked.account.slice(0,4)+'********',
  '- Account plan: FREE / ACTIVE',
  '- Remaining credits (USD): '+checked.creditsUsd.toFixed(2),
  '- Days until plan expiration: '+checked.daysRemaining,
  '- No EC2 creation, no SSM execution, no IAM changes.',
  '- Still requires operator approval, service eligibility, price estimate and isolated host planning.',
  ''
].join('\n');
console.log(result);
if(process.env.GITHUB_STEP_SUMMARY) await appendFile(process.env.GITHUB_STEP_SUMMARY,result);
