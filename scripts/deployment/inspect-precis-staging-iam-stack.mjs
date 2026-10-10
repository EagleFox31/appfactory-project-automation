#!/usr/bin/env node
// Read-only live CloudFormation status probe for the Précis staging reader.
// Used after the AWS identity/Free Plan gate; never plans or applies changes.
import {spawnSync} from 'node:child_process';
import {appendFile} from 'node:fs/promises';

const fail=(message)=>{throw new Error('Précis IAM staging status: '+message)};
if(process.env.GITHUB_ACTIONS!=='true' ||
   !['push','workflow_dispatch'].includes(process.env.GITHUB_EVENT_NAME) ||
   process.env.GITHUB_REF!=='refs/heads/main' ||
   process.env.GITHUB_REPOSITORY!=='EagleFox31/appfactory-project-automation')
  fail('untrusted GitHub Actions context');

const stack='precis-staging-iam-readonly';
const result=spawnSync('aws',[
  'cloudformation','describe-stacks',
  '--region','eu-west-3',
  '--stack-name',stack,
  '--output','json'
],{encoding:'utf8',timeout:30000,maxBuffer:1024*1024});
if(result.error)fail('AWS CLI execution unavailable: '+result.error.message);
let summary;
if(result.status!==0) {
  // Only one exact AWS missing-stack error can mean "pending provisioning".
  // Every other failure (including AccessDenied and connectivity) must fail closed.
  if(!/\(ValidationError\)[\s\S]*Stack with id precis-staging-iam-readonly does not exist/i.test(result.stderr||''))
    fail('CloudFormation read error; cannot assert tenant provisioning status: '+(result.stderr||'no details'));
  summary=[
    '### Précis staging IAM — IaC pending',
    '- Central AppFactory OIDC credentials and Free Plan were checked earlier in this job.',
    '- Tenant CloudFormation stack `precis-staging-iam-readonly` does not yet exist.',
    '- **No AWS resource was created or modified.**',
    '- Provision with the separate reviewed and explicitly authorized AppFactory IAM-only workflow.',
    ''
  ].join('\n');
} else {
  let parsed;
  try{parsed=JSON.parse(result.stdout);}catch{fail('invalid CloudFormation JSON');}
  const entries=parsed?.Stacks;
  if(!Array.isArray(entries)||entries.length!==1 || entries[0].StackName!==stack)
    fail('CloudFormation returned an unexpected stack');
  const current=entries[0];
  if(current.StackStatus!=='CREATE_COMPLETE')
    fail('unexpected tenant stack status: '+String(current.StackStatus));
  const expected='arn:aws:iam::458018461157:role/precis-translation-staging-free-plan-read';
  const outputs=current.Outputs||[];
  const reader=outputs.find(x=>x.OutputKey==='ReadOnlyRoleArn');
  if(reader?.OutputValue!==expected)
    fail('tenant role ARN output does not match the approved resource');
  summary=[
    '### Précis staging IAM — provisioned',
    '- CloudFormation stack `precis-staging-iam-readonly`: CREATE_COMPLETE.',
    '- Read-only tenant role ARN matches the dedicated account and resource.',
    '- **No AWS resource was created or modified by this status check.**',
    ''
  ].join('\n');
}
console.log(summary);
if(process.env.GITHUB_STEP_SUMMARY)await appendFile(process.env.GITHUB_STEP_SUMMARY,summary);
