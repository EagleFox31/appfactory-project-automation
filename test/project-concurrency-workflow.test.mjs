import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const root = new URL('../', import.meta.url);
const workflow = fs.readFileSync(
  new URL('.github/workflows/reusable-project-automation.yml', root),
  'utf8'
);

test('Project automation concurrency is scoped to the affected work item', () => {
  assert.match(
    workflow,
    /group: project-automation-\$\{\{ github\.repository \}\}-\$\{\{ inputs\.issue_number \|\| github\.event\.issue\.number \|\| github\.event\.pull_request\.number \|\| 'bootstrap' \}\}/
  );
  assert.match(workflow, /cancel-in-progress: false/);
  assert.doesNotMatch(
    workflow,
    /group: project-automation-\$\{\{ github\.repository \}\}\s*\n\s*cancel-in-progress: false/
  );
});
