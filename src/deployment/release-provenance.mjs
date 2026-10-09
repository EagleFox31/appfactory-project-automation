import { validateReleaseManifest } from './manifest.mjs';

const WORKFLOW = /^\.github\/workflows\/[a-zA-Z0-9_.-]+\.ya?ml$/;
function reject(message) { throw new Error('Release provenance: ' + message); }
function positiveInt(n, label) {
  if (!Number.isSafeInteger(n) || n < 1) reject(label + ' must be a positive integer');
  return n;
}
function requireWorkflow(path, label) {
  if (typeof path !== 'string' || !WORKFLOW.test(path)) reject(label + ' must be a trusted workflow path');
  return path;
}
function validateRun(run, { repository, sha, branch, path, event, kind }) {
  if (!run || typeof run !== 'object') reject(kind + ' run metadata missing');
  if (run.status !== 'completed' || run.conclusion !== 'success')
    reject(kind + ' workflow is not successful');
  if (run.event !== event) reject(kind + ' event mismatch');
  if (run.head_sha !== sha) reject(kind + ' source commit mismatch');
  if (run.head_branch !== branch) reject(kind + ' branch mismatch');
  if (run.head_repository?.full_name !== repository) reject(kind + ' repo mismatch');
  if (run.repository?.full_name && run.repository.full_name !== repository)
    reject(kind + ' repository metadata mismatch');
  if (run.path !== path) reject(kind + ' workflow path mismatch');
}
export async function verifyReleaseProvenance({
  manifest, config, repository, sourceSha, buildRunId,
  ciWorkflowPath, publishWorkflowPath, getRun, now = new Date()
}) {
  positiveInt(buildRunId, 'publishing run ID');
  requireWorkflow(ciWorkflowPath, 'CI workflow');
  requireWorkflow(publishWorkflowPath, 'publisher workflow');
  if (typeof getRun !== 'function') reject('a trusted GitHub run resolver is required');
  if (!(now instanceof Date) || !Number.isFinite(now.valueOf())) reject('invalid clock');

  if (!manifest || typeof manifest !== 'object') reject('manifest is missing');
  const ciRunId = positiveInt(manifest.ciRunId,'CI run ID');
  if (manifest.buildRunId !== buildRunId) reject('manifest build run is not the requested run');
  const verified = validateReleaseManifest(manifest, {
    config, repository, sourceSha, ciRunId, buildRunId
  });
  if (ciRunId === buildRunId) reject('CI and publisher must be distinct workflow runs');
  const [ci, publisher] = await Promise.all([getRun(ciRunId), getRun(buildRunId)]);
  validateRun(ci, {
    repository, sha:sourceSha, branch:config.releaseBranch,
    path:ciWorkflowPath, event:'push', kind:'CI'
  });
  validateRun(publisher, {
    repository, sha:sourceSha, branch:config.releaseBranch,
    path:publishWorkflowPath, event:'workflow_run', kind:'publisher'
  });
  if (Number(ci.id) !== ciRunId || Number(publisher.id) !== buildRunId)
    reject('GitHub run ID mismatch');
  const time = Date.parse(verified.createdAt);
  const started = Date.parse(publisher.created_at);
  const ended = Date.parse(publisher.updated_at);
  if (!Number.isFinite(started) || !Number.isFinite(ended)
    || time < started - 60_000 || time > ended + 60_000
    || time > now.valueOf() + 60_000)
    reject('manifest creation time is outside its publisher run');
  if (now.valueOf() - time > 90 * 24 * 3600_000)
    reject('manifest is older than 90 days');
  return { manifest:verified, ciRunId, buildRunId, publisherWorkflow:publisher.path };
}
export async function fetchGitHubWorkflowRun({ repository, runId, token, fetchImpl = fetch }) {
  if (typeof token !== 'string' || !token.trim()) reject('GitHub token required for run verification');
  positiveInt(runId, 'GitHub run ID');
  if (!/^[A-Za-z0-9-]+\/[A-Za-z0-9._-]+$/.test(repository || ''))
    reject('invalid repository');
  const url = 'https://api.github.com/repos/'+repository+'/actions/runs/'+runId;
  const response = await fetchImpl(url,{
    headers:{
      Accept:'application/vnd.github+json',
      Authorization:'Bearer '+token,
      'X-GitHub-Api-Version':'2022-11-28'
    }
  });
  if (!response.ok) reject('GitHub Actions run lookup failed: HTTP '+response.status);
  return response.json();
}
