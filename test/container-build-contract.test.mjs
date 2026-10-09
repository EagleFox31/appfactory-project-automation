import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { validateContainerConfig, validateSourceSha, createImageMatrix, publishEligibility }
  from '../src/deployment/contract.mjs';

const repository = 'EagleFox31/Pr-cis-Translation';
const sha = 'f'.repeat(40);
function fixture() {
  const root = mkdtempSync(join(tmpdir(),'appfactory-75-'));
  mkdirSync(join(root,'backend'));
  mkdirSync(join(root,'frontend'));
  for (const path of ['CHANGELOG.md','docker-compose.yml','backend/Dockerfile','frontend/Dockerfile'])
    writeFileSync(join(root,path),'fixture');
  const input = { schemaVersion:1,projectId:'precis-translation',environment:'staging',
    releaseBranch:'main',releaseMarker:'CHANGELOG.md',composePath:'docker-compose.yml',
    platforms:['linux/amd64','linux/arm64'],images:[
      {name:'api',dockerfile:'backend/Dockerfile',context:'.'},
      {name:'web',dockerfile:'frontend/Dockerfile',context:'.'}
    ] };
  return {root,input,done:()=>rmSync(root,{recursive:true,force:true})};
}
function validate(f) { return validateContainerConfig(f.input,{repository,root:f.root}); }

test('Précis images are isolated and pinned to SHA across architectures',()=>{
  const f=fixture();
  try {
    const cfg=validate(f), m=createImageMatrix(cfg,sha);
    assert.equal(m.include[0].tag,'ghcr.io/eaglefox31/pr-cis-translation-api:sha-'+sha);
    assert.equal(m.include[1].platforms,'linux/amd64,linux/arm64');
    assert.equal(m.include.length,2);
  } finally {f.done();}
});

test('unsafe and incomplete consumer configs are rejected',()=>{
  const changes=[
    f=>f.input.schemaVersion=2,
    f=>f.input.shell='rm -rf /',
    f=>f.input.images[0].buildArgs={SECRET:'oops'},
    f=>f.input.projectId='Other_Project',
    f=>f.input.releaseBranch='../../main',
    f=>f.input.environment='../production',
    f=>f.input.images[0].dockerfile='../secret',
    f=>f.input.images[0].context='/etc',
    f=>f.input.composePath='does-not-exist.yml',
    f=>f.input.platforms=['linux/s390x'],
    f=>f.input.platforms=['linux/amd64','linux/amd64'],
    f=>f.input.images[1].name='api',
    f=>f.input.images[0].name='api;echo hacked',
    f=>f.input.images=Array.from({length:7},(_,i)=>({name:'api-'+i,dockerfile:'backend/Dockerfile',context:'.'})),
    f=>symlinkSync('/etc',join(f.root,'external')) && (f.input.images[0].context='external')
  ];
  for(const mutate of changes){const f=fixture();try{mutate(f);assert.throws(()=>validate(f));}finally{f.done();}}
});

test('SSM target config requires explicit environment binding and rejects mismatched app',()=>{
  const f=fixture();
  try{
    const aws={transport:'aws-ssm',region:'eu-west-3',
      roleArn:'arn:aws:iam::123456789012:role/precis-staging',
      instanceId:'i-abcdef01234567890',
      ssmParameterPrefix:'/appfactory/precis-translation/staging/',
      composeProject:'precis-translation-staging',
      healthPath:'/health',
      serviceNames:['api','web']};
    f.input.deployment=aws;
    assert.equal(validate(f).deployment.instanceId,aws.instanceId);
    for(const [key,wrong] of [
      ['composeProject','atelier-maitre-prod'],['ssmParameterPrefix','/atelier-maitre/prod/'],
      ['instanceId','not-an-instance'],['region','eu-west-3;evil'],
      ['healthPath','http://evil'],['serviceNames',['api','api']]
    ]){
      f.input.deployment={...aws,[key]:wrong};
      assert.throws(()=>validate(f),Error,key);
    }
    f.input.deployment={...aws,command:'untrusted-shell'};
    assert.throws(()=>validate(f));
  }finally{f.done();}
});

test('invalid source ref is never treated as an immutable commit',()=>{
  assert.equal(validateSourceSha(sha),sha);
  for(const value of ['main','refs/heads/main','bad','g'.repeat(40),'a'.repeat(41),''])
    assert.throws(()=>validateSourceSha(value));
});
function context(overrides={}){
  const values={mode:'publish',eventName:'workflow_run',repository,sha,
    config:{releaseBranch:'main',releaseMarker:'CHANGELOG.md'},markerChanged:true,
    event:{workflow_run:{conclusion:'success',event:'push',head_sha:sha,head_branch:'main',
      head_repository:{full_name:repository}}}};
  if(overrides.workflow_run) values.event.workflow_run={...values.event.workflow_run,...overrides.workflow_run};
  return {...values,...Object.fromEntries(Object.entries(overrides).filter(([key])=>key!=='workflow_run'))};
}
test('plan mode is guaranteed read-only and never publishes',()=>{
  assert.equal(publishEligibility(context({mode:'plan'})).eligible,false);
});
test('publication requires same repo, exact SHA, main-branch CI and changed release marker',()=>{
  assert.equal(publishEligibility(context()).eligible,true);
  assert.equal(publishEligibility(context({markerChanged:false})).eligible,false);
  for(const c of [
    {eventName:'workflow_dispatch'}, {eventName:'pull_request'},
    {workflow_run:{conclusion:'failure'}}, {workflow_run:{event:'pull_request'}},
    {workflow_run:{head_branch:'feature'}}, {workflow_run:{head_sha:'0'.repeat(40)}},
    {workflow_run:{head_repository:{full_name:'EagleFox31/atelier2026'}}}
  ]) assert.throws(()=>publishEligibility(context(c)),Error,JSON.stringify(c));
});
