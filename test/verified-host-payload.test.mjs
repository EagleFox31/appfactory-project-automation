import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { assembleReleaseManifest } from '../src/deployment/manifest.mjs';
import { validateContainerConfig } from '../src/deployment/contract.mjs';
import { assembleVerifiedHostPayload } from '../src/deployment/verified-host-payload.mjs';

const repository='EagleFox31/Pr-cis-Translation';
const sha='a'.repeat(40);
const digest='sha256:'+'2'.repeat(64);
const image='ghcr.io/eaglefox31/pr-cis-translation-api';
function fixture(){
  const root=mkdtempSync(join(tmpdir(),'appfactory-verified-payload-'));
  mkdirSync(join(root,'.github'));
  mkdirSync(join(root,'backend'));
  mkdirSync(join(root,'frontend'));
  mkdirSync(join(root,'scripts'));
  for(const file of ['CHANGELOG.md','docker-compose.yml','backend/Dockerfile','frontend/Dockerfile','scripts/backup.sh'])
    writeFileSync(join(root,file),'ok\n');
  const rawConfig={
    schemaVersion:1,projectId:'precis-translation',environment:'staging',
    releaseBranch:'main',releaseMarker:'CHANGELOG.md',
    composePath:'docker-compose.yml',platforms:['linux/amd64','linux/arm64'],
    images:[{name:'api',dockerfile:'backend/Dockerfile',context:'.'}],
    deployment:{
      transport:'aws-ssm',region:'eu-west-3',
      roleArn:'arn:aws:iam::123456789012:role/precis-translation-staging',
      instanceId:'i-abcdef01234567890',
      ssmParameterPrefix:'/appfactory/precis-translation/staging/',
      composeProject:'precis-translation-staging',
      healthPath:'/health',healthUrl:'http://127.0.0.1/health',
      serviceNames:['backend'],imageServices:{api:'backend'},
      backupKinds:['database','documents'],
      predeployHook:'scripts/backup.sh',
      runtimeEnvTarget:'backend/.env'
    }
  };
  const config=validateContainerConfig(rawConfig,{root,repository});
  const manifest=assembleReleaseManifest({
    config,repository,sourceSha:sha,ciRunId:110,buildRunId:220,
    createdAt:'2026-10-09T12:00:00Z',
    receipts:[{name:'api',image,sourceSha:sha,digest}]
  });
  const provenance={manifest,ciRunId:110,buildRunId:220};
  const awsIdentity={Account:'123456789012'};
  const awsInstances={Reservations:[{Instances:[{
    InstanceId:'i-abcdef01234567890',Architecture:'arm64',
    State:{Name:'running'},PlatformDetails:'Linux/UNIX',
    Tags:[
      {Key:'AppFactoryProject',Value:'precis-translation'},
      {Key:'AppFactoryEnvironment',Value:'staging'},
      {Key:'AppFactoryRepository',Value:repository}
    ]
  }]}]};
  const awsSsm={InstanceInformationList:[{
    InstanceId:'i-abcdef01234567890',PingStatus:'Online',PlatformType:'Linux'
  }]};
  const inputs={root,rawConfig,repository,sourceSha:sha,
    requestedEnvironment:'staging',manifest,provenance,awsIdentity,awsInstances,awsSsm};
  return {root,inputs,dispose:()=>rmSync(root,{recursive:true,force:true})};
}
test('verified immutable GitHub manifest maps only approved images into isolated host payload',()=>{
  const f=fixture();
  try{
    const out=assembleVerifiedHostPayload(f.inputs);
    assert.deepEqual(Object.keys(out).sort(),[
      'schemaVersion','projectId','environment','repository','sourceSha',
      'composeProject','composePath','runtimeEnvTarget','predeployHook','healthUrl',
      'images','imageServices','backupKinds'
    ].sort());
    assert.equal(out.images.api,image+'@'+digest);
    assert.deepEqual(out.imageServices,{api:'backend'});
    assert.equal(out.runtimeEnvTarget,'backend/.env');
    assert.equal(out.predeployHook,'scripts/backup.sh');
    assert.equal(out.environment,'staging');
    assert.equal(JSON.stringify(out).includes('roleArn'),false);
    assert.equal(JSON.stringify(out).includes('POSTGRES_PASSWORD'),false);
  }finally{f.dispose();}
});
test('rejects forged manifest/provenance, wrong AWS tenant and bad host paths',()=>{
  const scenarios=[
    x=>x.provenance=null,
    x=>x.provenance.ciRunId=999,
    x=>x.provenance.manifest.images[0].digest='sha256:'+'f'.repeat(64),
    x=>x.manifest.sourceSha='e'.repeat(40),
    x=>x.rawConfig.deployment.roleArn='arn:aws:iam::123456789012:role/atelier-maitre-prod',
    x=>x.awsIdentity.Account='999999999999',
    x=>x.awsInstances.Reservations[0].Instances[0].Tags[2].Value='EagleFox31/atelier2026',
    x=>x.awsSsm.InstanceInformationList[0].PingStatus='ConnectionLost',
    x=>x.requestedEnvironment='production',
    x=>x.rawConfig.deployment.imageServices.api='db',
    x=>x.rawConfig.deployment.imageServices.api='unknown',
    x=>x.rawConfig.deployment.healthUrl='http://127.0.0.1/admin',
    x=>x.rawConfig.deployment.runtimeEnvTarget='../../.env',
    x=>x.rawConfig.deployment.runtimeEnvTarget='backend/config.json',
    x=>x.rawConfig.deployment.predeployHook='missing.sh',
    x=>x.rawConfig.deployment.predeployHook='../unsafe.sh',
    x=>delete x.rawConfig.deployment.backupKinds,
    x=>delete x.rawConfig.deployment.runtimeEnvTarget,
    x=>delete x.rawConfig.deployment.predeployHook
  ];
  for(const modify of scenarios){
    const f=fixture();
    try{
      const copy=structuredClone(f.inputs);
      modify(copy);
      assert.throws(()=>assembleVerifiedHostPayload(copy),undefined,modify.toString());
    }finally{f.dispose();}
  }
});
test('read-only rollout planning workflow performs authenticated checks but no mutations',()=>{
  const path=new URL('../.github/workflows/reusable-container-ssm-rollout-plan.yml',import.meta.url);
  const source=readFileSync(path,'utf8');
  assert.match(source,/workflow_call/);
  assert.match(source,/environment: \$\{\{ needs\.validate\.outputs\.environment \}\}/);
  assert.match(source,/actions: read/);
  assert.match(source,/id-token: write/);
  assert.match(source,/appfactory-release-manifest/);
  assert.match(source,/assemble-ssm-host-payload\.mjs/);
  assert.match(source,/appfactory-verified-host-payload/);
  assert.doesNotMatch(source,/aws ssm send-command/i);
  assert.doesNotMatch(source,/docker compose up/i);
  assert.doesNotMatch(source,/packages: write/i);
  assert.doesNotMatch(source,/contents: write/i);
  const cli=readFileSync(new URL('../scripts/deployment/assemble-ssm-host-payload.mjs',import.meta.url),'utf8');
  assert.match(cli,/verifyReleaseProvenance/);
  assert.match(cli,/APPFACTORY_CI_WORKFLOW/);
  assert.match(cli,/workflow_dispatch/);
  assert.doesNotMatch(cli,/SendCommand|send-command|--with-decryption/);
});
