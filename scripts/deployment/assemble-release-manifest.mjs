#!/usr/bin/env node
import { readdir, readFile, writeFile, appendFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { createHash } from 'node:crypto';
import { validateContainerConfig, validateSourceSha, publishEligibility }
  from '../../src/deployment/contract.mjs';
import { assembleReleaseManifest, validateReleaseManifest }
  from '../../src/deployment/manifest.mjs';

const repository = process.env.GITHUB_REPOSITORY;
const sha = validateSourceSha(process.env.APPFACTORY_SOURCE_SHA);
const config = validateContainerConfig(JSON.parse(
  await readFile(process.env.APPFACTORY_DEPLOY_CONFIG || '.github/appfactory-deploy.json','utf8')),
  { repository, root: process.cwd() }
);
const event = JSON.parse(await readFile(process.env.GITHUB_EVENT_PATH, 'utf8'));
const eligible = publishEligibility({
  mode:'publish', eventName:process.env.GITHUB_EVENT_NAME,
  event, repository, sha, config, markerChanged:true
});
if (!eligible.eligible) throw new Error('CI proof is not eligible for image publishing');
const ciRunId = Number(event.workflow_run.id);
const buildRunId = Number(process.env.GITHUB_RUN_ID);
const directory = resolve(process.env.APPFACTORY_RECEIPTS_DIR || 'appfactory-receipts');
const receiptFiles = (await readdir(directory)).filter(name => /^receipt-[a-z0-9-]+\.json$/.test(name));
const receipts = await Promise.all(receiptFiles.map(async name =>
  JSON.parse(await readFile(join(directory, name), 'utf8'))
));
const manifest = assembleReleaseManifest({
  config, repository, sourceSha:sha, ciRunId, buildRunId,
  receipts, createdAt:new Date().toISOString()
});
validateReleaseManifest(manifest,{config,repository,sourceSha:sha,ciRunId,buildRunId});
const output = process.env.APPFACTORY_MANIFEST_FILE || 'appfactory-release-manifest.json';
const data = JSON.stringify(manifest,null,2)+'\n';
await writeFile(output,data,{flag:'wx',mode:0o600});
const checksum = createHash('sha256').update(data).digest('hex');
await writeFile(output+'.sha256',checksum+'  '+output+'\n',{flag:'wx',mode:0o600});
const summary=[
  '### Trusted image digest manifest',
  '- Exact consumer commit: '+sha,
  '- CI run: '+ciRunId,
  '- Build run: '+buildRunId,
  '- Manifest checksum: sha256:'+checksum,
  ...manifest.images.map(image => '- '+image.name+': '+image.ref),
  '- No Compose rollout or cloud action performed.',
  ''
].join('\n');
console.log(summary);
if (process.env.GITHUB_STEP_SUMMARY) await appendFile(process.env.GITHUB_STEP_SUMMARY,summary);
