import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {validatePrecisIamApproval,PRECIS_IAM_APPROVAL_FILE} from '../src/deployment/precis-iam-gitops-approval.mjs';

const now=new Date('2026-10-10T12:00:00Z');
const approval={
  decision:'APPROVE_CREATE_ONLY',
  account:'458018461157',
  repository:'EagleFox31/Pr-cis-Translation',
  stack:'precis-staging-iam-readonly',
  iamRole:'precis-translation-staging-free-plan-read',
  consumerSha:'18618e5ca8b76a3a6b62278e16e0c6fd2fd078fd',
  templateGitBlob:'996be22806afb8fc1eecc11432d8b9ac64548dd2',
  approvedBy:'EagleFox31',
  approvedAt:'2026-10-10T11:50:00Z',
  expiresAt:'2026-10-11T11:40:00Z'
};
const input={
  approval,actor:'EagleFox31',repository:'EagleFox31/appfactory-project-automation',
  event:'push',ref:'refs/heads/main',changedPaths:[PRECIS_IAM_APPROVAL_FILE],now
};
const check=(override={})=>validatePrecisIamApproval({...structuredClone(input),...override});
test('only one recent owner-approved tenant IAM reader marker can dispatch',()=>{
  const r=check();
  assert.equal(r.approved,true);
  assert.equal(r.exactChange,PRECIS_IAM_APPROVAL_FILE);
});
test('rejects foreign actor, repo, event, branch and mixed changes',()=>{
  for(const changed of [
    {actor:'another-user'}, {repository:'EagleFox31/atelier2026'},
    {event:'pull_request'}, {ref:'refs/heads/staging'},
    {changedPaths:[PRECIS_IAM_APPROVAL_FILE,'infra/aws/appfactory-central-staging-iam-bootstrap.yml']},
    {changedPaths:['docs/README.md']},
    {changedPaths:[]}
  ]) assert.throws(()=>check(changed));
});
test('rejects unauthorized scope, stale timestamps and extra fields',()=>{
  for(const changes of [
    {decision:'APPROVE_ALL'},
    {stack:'atelier-maitre-prod'},
    {account:'000000000000'},
    {approvedBy:'someone-else'},
    {consumerSha:'malicious'},
    {templateGitBlob:'other'},
    {expiresAt:'2026-10-10T11:00:00Z'},
    {expiresAt:'2026-10-12T12:00:00Z'},
    {approvedAt:'2026-10-10T13:00:00Z'},
    {approvedAt:'garbage'}
  ]) assert.throws(()=>check({approval:{...approval,...changes}}));
  assert.throws(()=>check({approval:{...approval,permissions:'iam:*'}}));
});
test('dispatch workflow cannot touch AWS, and requires owner-origin main push',()=>{
  const path=new URL('../.github/workflows/approved-precis-iam-dispatch.yml',import.meta.url);
  const wf=readFileSync(path,'utf8');
  assert.match(wf,/branches: \[main\]/);
  assert.ok(wf.includes('infra/aws/approvals/precis-staging-iam-reader.json'));
  assert.match(wf,/github\.actor == 'EagleFox31'/);
  assert.match(wf,/verify-precis-iam-gitops-approval\.mjs/);
  assert.match(wf,/gh workflow run appfactory-precis-staging-iam\.yml/);
  assert.match(wf,/actions: write/);
  assert.doesNotMatch(wf,/aws (cloudformation|ec2|iam|ssm|freetier)|role-to-assume|id-token: write/);
});
