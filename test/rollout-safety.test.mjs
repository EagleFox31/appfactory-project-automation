import test from 'node:test';
import assert from 'node:assert/strict';
import { assembleReleaseManifest } from '../src/deployment/manifest.mjs';
import { prepareRolloutPlan } from '../src/deployment/rollout.mjs';

const repository='EagleFox31/Pr-cis-Translation';
const sha='a'.repeat(40), oldSha='b'.repeat(40);
const digest='sha256:'+'1'.repeat(64), previousDigest='sha256:'+'2'.repeat(64);
const composeChecksum='sha256:'+'3'.repeat(64);
const image='ghcr.io/eaglefox31/pr-cis-translation-api';
const config={
  projectId:'precis-translation',environment:'staging',
  images:[{name:'api',image,platforms:'linux/amd64,linux/arm64'}],
  deployment:{
    transport:'aws-ssm',region:'eu-west-3',roleArn:'arn:aws:iam::123456789012:role/precis-translation-staging',
    instanceId:'i-abcdef01234567890',ssmParameterPrefix:'/appfactory/precis-translation/staging/',
    composeProject:'precis-translation-staging',serviceNames:['backend'],
    healthPath:'/health',healthUrl:'http://127.0.0.1/health',
    imageServices:{api:'backend'},backupKinds:['database','documents']
  }
};
const manifest=assembleReleaseManifest({
  config,repository,sourceSha:sha,ciRunId:10,buildRunId:20,
  createdAt:'2026-10-09T12:01:00.000Z',
  receipts:[{name:'api',image,sourceSha:sha,digest}]
});
const inspection={
  instanceId:'i-abcdef01234567890',account:'123456789012',ssm:'Online',
  architecture:'linux/arm64',
  tags:{AppFactoryProject:'precis-translation',
    AppFactoryEnvironment:'staging',AppFactoryRepository:repository}
};
const priorState={
  schemaVersion:1,repository,projectId:'precis-translation',
  environment:'staging',sourceSha:oldSha,
  composeChecksum,images:[{name:'api',ref:image+'@'+previousDigest}]
};
const backupEvidence={
  projectId:'precis-translation',environment:'staging',sourceSha:sha,
  createdAt:'2026-10-09T12:03:00.000Z',quiescent:true,
  artifacts:[
    {kind:'database',path:'/opt/appfactory/precis-translation/staging/backups/20261009/database.sql.gz',
      sha256:digest,bytes:4120},
    {kind:'documents',path:'/opt/appfactory/precis-translation/staging/backups/20261009/documents.tar.gz',
      sha256:previousDigest,bytes:18000}
  ]
};
function inputs(){
  return {config:structuredClone(config),repository,sourceSha:sha,
    manifest:structuredClone(manifest),inspection:structuredClone(inspection),
    priorState:structuredClone(priorState),backupEvidence:structuredClone(backupEvidence),
    composeChecksum,now:new Date('2026-10-09T12:04:00.000Z')};
}
test('generates digest-pinned isolated app-only rollout and rollback overrides',()=>{
  const plan=prepareRolloutPlan(inputs());
  assert.deepEqual(plan.nextOverride,{services:{backend:{image:image+'@'+digest}}});
  assert.deepEqual(plan.rollbackOverride,{services:{backend:{image:image+'@'+previousDigest}}});
  assert.equal(plan.rollbackEligible,true);
  assert.deepEqual(plan.approvedServices,['backend']);
  assert.equal(JSON.stringify(plan).includes('POSTGRES_PASSWORD'),false);
});
test('same image rollback must be reported unsafe when Compose definition changed',()=>{
  const q=inputs();q.priorState.composeChecksum='sha256:'+'f'.repeat(64);
  const plan=prepareRolloutPlan(q);
  assert.equal(plan.rollbackEligible,false);
});
test('rejects wrong target and cross-project image/backup data',()=>{
  const changes=[
    q=>q.inspection.account='987654321098',
    q=>q.inspection.instanceId='i-00000000000000000',
    q=>q.inspection.ssm='ConnectionLost',
    q=>q.inspection.tags.AppFactoryRepository='EagleFox31/atelier2026',
    q=>q.priorState.projectId='atelier-maitre',
    q=>q.priorState.images[0].ref='ghcr.io/eaglefox31/atelier2026-api@'+previousDigest,
    q=>q.priorState.images[0].ref=image+':latest',
    q=>q.priorState.images[0].ref='ghcr.io/evil/precis@'+previousDigest,
    q=>q.manifest.repository='EagleFox31/atelier2026',
    q=>q.manifest.images[0].ref=image+':latest',
    q=>q.config.deployment.imageServices.api='db',
    q=>q.config.deployment.imageServices.api='different-service',
    q=>q.inspection.architecture='linux/s390x'
  ];
  for(const mutate of changes){const q=inputs();mutate(q);
    assert.throws(()=>prepareRolloutPlan(q),undefined,JSON.stringify(mutate.toString()));
  }
});
test('rejects missing, stale, non-quiescent or malformed backups',()=>{
  const changes=[
    q=>q.backupEvidence.quiescent=false,
    q=>q.backupEvidence.createdAt='2026-10-08T00:00:00Z',
    q=>q.backupEvidence.createdAt='2026-10-11T00:00:00Z',
    q=>q.backupEvidence.projectId='atelier-maitre',
    q=>q.backupEvidence.sourceSha=oldSha,
    q=>q.backupEvidence.artifacts.pop(),
    q=>q.backupEvidence.artifacts[0].path='/tmp/backup.sql.gz',
    q=>q.backupEvidence.artifacts[0].path='/opt/appfactory/precis-translation/staging/backups/../../secret',
    q=>q.backupEvidence.artifacts[0].sha256='latest',
    q=>q.backupEvidence.artifacts[0].bytes=0,
    q=>q.backupEvidence.artifacts[1].kind='database',
    q=>q.config.deployment.backupKinds=[]
  ];
  for(const mutate of changes){const q=inputs();mutate(q);
    assert.throws(()=>prepareRolloutPlan(q));
  }
});
test('does not silently approve a brand new host without prior rollback state',()=>{
  const q=inputs();q.priorState=null;
  assert.throws(()=>prepareRolloutPlan(q),/previous deployment state/);
});
