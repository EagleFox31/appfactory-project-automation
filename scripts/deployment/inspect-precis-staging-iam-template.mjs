#!/usr/bin/env node
// Deny consumer-template substitution before privileged CloudFormation calls.
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
const path='.precis/deploy/infra/aws-free-plan-readonly-role.yml';
const bytes=readFileSync(path);
const gitBlob=createHash('sha1')
  .update('blob '+bytes.length+'\0')
  .update(bytes).digest('hex');
// The exact reviewed GitHub blob from Précis repair PR #8: bounded reader only.
// A change to that file must explicitly update this fingerprint through review.
const REVIEWED_BLOB='996be22806afb8fc1eecc11432d8b9ac64548dd2';
if(gitBlob!==REVIEWED_BLOB)
  throw new Error('Précis staging IAM template differs from exact reviewed Git blob');
const source=bytes.toString('utf8');
for(const field of [
  'RoleName: precis-translation-staging-free-plan-read',
  'PermissionsBoundary: !Ref PermissionsBoundaryArn',
  'AppFactoryProject',
  'AppFactoryEnvironment',
  'freetier:GetAccountPlanState'
]) {
  if(!source.includes(field))throw new Error('Expected bounded reader field missing: '+field);
}
console.log('Reviewed Précis IAM template verified: '+gitBlob);
