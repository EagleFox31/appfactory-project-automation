import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { assembleReleaseManifest } from '../src/deployment/manifest.mjs';
import { verifyReleaseProvenance, fetchGitHubWorkflowRun }
  from '../src/deployment/release-provenance.mjs';

const repository='EagleFox31/Pr-cis-Translation', sha='f'.repeat(40);
const config={
  projectId:'precis-translation',environment:'staging',releaseBranch:'main',
  images:[{name:'api',image:'ghcr.io/eaglefox31/pr-cis-translation-api',
    platforms:'linux/amd64,linux/arm64'}]
};
const ciWorkflowPath='.github/workflows/ci.yml';
const publishWorkflowPath='.github/workflows/container-publish.yml';
const createdAt='2026-10-09T12:02:00.000Z';
const manifest=assembleReleaseManifest({
  config,repository,sourceSha:sha,ciRunId:1200,buildRunId:1300,createdAt,
  receipts:[{name:'api',image:config.images[0].image,sourceSha:sha,digest:'sha256:'+'a'.repeat(64)}]
});
const ci={
  id:1200,status:'completed',conclusion:'success',event:'push',head_sha:sha,
  head_branch:'main',head_repository:{full_name:repository},repository:{full_name:repository},
  path:ciWorkflowPath,created_at:'2026-10-09T11:50:00Z',updated_at:'2026-10-09T11:55:00Z'
};
const build={
  ...ci,id:1300,event:'workflow_run',path:publishWorkflowPath,
  created_at:'2026-10-09T12:00:00Z',updated_at:'2026-10-09T12:05:00Z'
};
function args(mod={}) {
  const ciCopy=structuredClone(ci), buildCopy=structuredClone(build);
  if(mod.ci)Object.assign(ciCopy,mod.ci);
  if(mod.build)Object.assign(buildCopy,mod.build);
  return {manifest:structuredClone(manifest),config,repository,sourceSha:sha,buildRunId:1300,
    ciWorkflowPath,publishWorkflowPath,now:new Date('2026-10-09T12:06:00Z'),
    getRun:async id=>id===1200?ciCopy:buildCopy};
}
test('accepts immutable manifest only after matching successful GitHub CI and publisher runs',async()=>{
  const proof=await verifyReleaseProvenance(args());
  assert.equal(proof.ciRunId,1200);
  assert.equal(proof.buildRunId,1300);
  assert.equal(proof.manifest.images[0].ref,config.images[0].image+'@sha256:'+'a'.repeat(64));
});
test('rejects malicious foreign, failed or spoofed CI and build workflow identity',async()=>{
  const cases=[
    {ci:{conclusion:'failure'}},{build:{conclusion:'failure'}},
    {ci:{status:'in_progress'}},{build:{event:'workflow_dispatch'}},
    {ci:{event:'pull_request'}},{build:{head_sha:'e'.repeat(40)}},
    {ci:{head_branch:'test'}},{build:{head_repository:{full_name:'EagleFox31/atelier2026'}}},
    {ci:{path:'.github/workflows/fake.yml'}},{build:{path:'.github/workflows/other.yml'}},
    {ci:{id:99}},{build:{id:99}},
    {build:{created_at:'2026-10-09T12:04:00Z'}}
  ];
  for(const c of cases)await assert.rejects(()=>verifyReleaseProvenance(args(c)),/Release provenance/);
});
test('rejects stale or future artifacts, wrong build run and unsigned workflow claims',async()=>{
  for(const change of [
    p=>p.buildRunId=123,
    p=>p.manifest.sourceSha='e'.repeat(40),
    p=>p.manifest.images[0].digest='sha256:'+'0'.repeat(64),
    p=>p.ciWorkflowPath='../../ci.yml',
    p=>p.publishWorkflowPath='ci.yml',
    p=>p.now=new Date('2027-05-01T00:00:00Z'),
    p=>p.now=new Date('2026-10-08T00:00:00Z')
  ]){const p=args();change(p);await assert.rejects(()=>verifyReleaseProvenance(p));}
});
test('authenticated run lookup rejects missing credentials and network failure',async()=>{
  await assert.rejects(()=>fetchGitHubWorkflowRun({repository,runId:1200,token:''}));
  const request=[];
  const answer=await fetchGitHubWorkflowRun({repository,runId:1200,token:'masked',fetchImpl:async(u,options)=>{
    request.push({u,options});
    return {ok:true,json:async()=>ci};
  }});
  assert.equal(answer.id,1200);
  assert.equal(request[0].u,'https://api.github.com/repos/'+repository+'/actions/runs/1200');
  await assert.rejects(()=>fetchGitHubWorkflowRun({repository,runId:1200,token:'masked',
    fetchImpl:async()=>({ok:false,status:403})}),/HTTP 403/);
});
test('read-only verification workflow does not request cloud or mutation permissions',()=>{
  const yml=readFileSync(new URL('../.github/workflows/reusable-container-release-verify.yml',import.meta.url),'utf8');
  assert.match(yml,/actions: read/);
  assert.match(yml,/name: appfactory-release-manifest/);
  assert.match(yml,/run-id: \$\{\{ inputs\.build_run_id \}\}/);
  assert.match(yml,/verify-release-provenance.mjs/);
  assert.doesNotMatch(yml,/^\s*(id-token|packages|contents): write/m);
  assert.doesNotMatch(yml,/^\s*uses: aws-actions\//m);
});
