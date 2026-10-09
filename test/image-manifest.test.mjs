import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { assembleReleaseManifest, validateReleaseManifest, validateImageReceipt }
  from '../src/deployment/manifest.mjs';

const sha='a'.repeat(40), digestA='sha256:'+'1'.repeat(64),digestB='sha256:'+'2'.repeat(64);
const repository='EagleFox31/Pr-cis-Translation';
const config={
  projectId:'precis-translation',environment:'staging',
  images:[
    {name:'api',image:'ghcr.io/eaglefox31/pr-cis-translation-api',
      dockerfile:'backend/Dockerfile',context:'.',platforms:'linux/amd64,linux/arm64'},
    {name:'web',image:'ghcr.io/eaglefox31/pr-cis-translation-web',
      dockerfile:'frontend/Dockerfile',context:'.',platforms:'linux/amd64,linux/arm64'}
  ]
};
const receipts=[
  {name:'api',image:'ghcr.io/eaglefox31/pr-cis-translation-api',sourceSha:sha,digest:digestA},
  {name:'web',image:'ghcr.io/eaglefox31/pr-cis-translation-web',sourceSha:sha,digest:digestB}
];
const opts={config,repository,sourceSha:sha,ciRunId:1234,buildRunId:5678};
function assemble(rows=receipts) {
  return assembleReleaseManifest({...opts,receipts:rows,createdAt:'2026-10-09T12:00:00Z'});
}
test('multi-arch build receipts assemble exact image-digest manifest with CI run identity',()=>{
  const artifact=assemble();
  assert.equal(artifact.schemaVersion,1);
  assert.deepEqual(artifact.images.map(i=>i.name),['api','web']);
  assert.equal(artifact.images[0].ref,receipts[0].image+'@'+digestA);
  assert.deepEqual(artifact.images[1].platforms,['linux/amd64','linux/arm64']);
  assert.equal(artifact.ciRunId,1234);
  assert.equal(artifact.buildRunId,5678);
  assert.deepEqual(validateReleaseManifest(artifact,opts),artifact);
});
test('reject duplicate, absent, foreign and mutable image receipts',()=>{
  for(const list of [
    [receipts[0]],
    [...receipts,receipts[0]],
    [receipts[0],{...receipts[1],name:'third'}],
    [receipts[0],{...receipts[1],image:'ghcr.io/another-tenant/web'}],
    [receipts[0],{...receipts[1],sourceSha:'b'.repeat(40)}],
    [receipts[0],{...receipts[1],digest:'latest'}],
    [receipts[0],{...receipts[1],digest:'sha256:'+'f'.repeat(63)}],
    [receipts[0],{...receipts[1],digest:'sha256:'+'F'.repeat(64)}]
  ])assert.throws(()=>assemble(list),/Container release manifest/);
});
test('release manifest refuses tampering with identity, image digest or architecture',()=>{
  const template=assemble();
  const variations=[
    m=>m.repository='EagleFox31/atelier2026',
    m=>m.projectId='atelier-maitre',
    m=>m.environment='production',
    m=>m.sourceSha='b'.repeat(40),
    m=>m.ciRunId=2,
    m=>m.buildRunId=2,
    m=>m.schemaVersion=2,
    m=>m.images[0].image='ghcr.io/another/tenant',
    m=>m.images[0].digest='sha256:'+'9'.repeat(64),
    m=>m.images[0].ref='ghcr.io/another/tenant@'+digestA,
    m=>m.images[0].platforms=['linux/amd64'],
    m=>m.images[0].sourceSha='x'.repeat(40),
    m=>m.images.pop(),
    m=>m.secret='oops'
  ];
  for(const change of variations){
    const manifest=structuredClone(template);
    change(manifest);
    assert.throws(()=>validateReleaseManifest(manifest,opts),/Container release manifest/);
  }
});
test('receipt rejects extra injected fields as well as invalid SHA',()=>{
  const expected={...config.images[0],sha};
  assert.throws(()=>validateImageReceipt({...receipts[0],shell:'curl evil'},expected));
  assert.throws(()=>validateImageReceipt({...receipts[0],sourceSha:'b'.repeat(40)},expected));
  assert.throws(()=>assembleReleaseManifest({...opts,sourceSha:'not-a-sha',receipts,createdAt:'now'}));
});
test('publish workflow requires artifact manifest and reports failure honestly',()=>{
  const workflow=readFileSync(new URL('../.github/workflows/reusable-container-build.yml',import.meta.url),'utf8');
  assert.match(workflow,/name: appfactory-image-receipt-\$\{\{ matrix\.name \}\}/);
  assert.match(workflow,/pattern: appfactory-image-receipt-\*/);
  assert.match(workflow,/name: appfactory-release-manifest/);
  assert.match(workflow,/needs: \[plan, publish, manifest\]/);
  assert.match(workflow,/MANIFEST_RESULT: \$\{\{ needs\.manifest\.result \}\}/);
  assert.match(workflow,/Image release manifest creation failed/);
  assert.match(workflow,/retention-days: 90/);
  assert.doesNotMatch(workflow,/^\s*aws (ssm send-command|ec2 run-instances)/m);
});
