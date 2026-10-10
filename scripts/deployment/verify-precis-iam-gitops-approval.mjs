#!/usr/bin/env node
import {readFileSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import {PRECIS_IAM_APPROVAL_FILE,validatePrecisIamApproval} from '../../src/deployment/precis-iam-gitops-approval.mjs';

const required=(name)=>{const v=process.env[name];if(!v)throw new Error('Missing '+name);return v;};
if(process.env.GITHUB_ACTIONS!=='true')throw new Error('GitHub Actions only');
const before=required('APPROVAL_BEFORE');
const after=required('GITHUB_SHA');
if(!/^[a-f0-9]{40}$/.test(before)||!/[1-9a-f]/.test(before)||
   !/^[a-f0-9]{40}$/.test(after)||before===after)
  throw new Error('Invalid before/after Git commit IDs');
const paths=execFileSync('git',['diff','--name-only',before,after,'--'],{
  encoding:'utf8',maxBuffer:1024*1024,timeout:20000
}).trim().split('\n').filter(Boolean);
const decision=JSON.parse(readFileSync(PRECIS_IAM_APPROVAL_FILE,'utf8'));
const checked=validatePrecisIamApproval({
  approval:decision,
  actor:required('GITHUB_ACTOR'),
  repository:required('GITHUB_REPOSITORY'),
  ref:required('GITHUB_REF'),
  event:required('GITHUB_EVENT_NAME'),
  changedPaths:paths
});
console.log('Approved GitOps dispatch for '+checked.stack+' (IAM reader only)');
