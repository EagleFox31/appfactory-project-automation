import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

test('host-side Compose rollout/backup/rollback simulation passes under Python', () => {
  const cmd=spawnSync('python3',
    ['-m','unittest','discover','-s','test','-p','test_ssm_host_rollout.py','-v'],
    {encoding:'utf8',timeout:120000});
  assert.equal(cmd.status,0,
    'Python rollout safety suite failed:\n'+cmd.stdout+'\n'+cmd.stderr);
  assert.match(cmd.stderr,/Ran 6 tests/);
});
test('host rollout has no mutable tag, docker down, volume pruning or external health endpoint',()=>{
  const src=readFileSync(new URL('../scripts/deployment/ssm-host-rollout.py',import.meta.url),'utf8');
  assert.match(src,/--no-deps/);
  assert.match(src,/--no-build/);
  assert.match(src,/verify_backup/);
  assert.match(src,/validate_previous/);
  assert.match(src,/ROLLBACK_MIGRATIONS_PLACEHOLDER|database schema was not reverted/);
  assert.doesNotMatch(src,/docker image prune|down -v|--remove-orphans/);
  assert.doesNotMatch(src,/subprocess\.run\([^\n]*shell\s*=\s*True/);
});
