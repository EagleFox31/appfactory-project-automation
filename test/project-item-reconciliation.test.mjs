import test from 'node:test';
import assert from 'node:assert/strict';
import {
  addProjectItemWithReconciliation,
  isTransientProjectItemConflict
} from '../src/github/project-item-reconciliation.mjs';

test('a known GitHub Projects transient conflict is recognized, unrelated errors are not', () => {
  assert.equal(isTransientProjectItemConflict(
    new Error('GitHub GraphQL error: Your attempt to move this item created a temporary conflict. Please try again.')
  ), true);
  assert.equal(isTransientProjectItemConflict(new Error('Resource not accessible by integration')), false);
  assert.equal(isTransientProjectItemConflict(new Error('Bad credentials')), false);
});

test('existing item is a read-only no-op', async () => {
  let writes = 0;
  const result = await addProjectItemWithReconciliation({
    findExisting: async () => 'item-one',
    addItem: async () => { writes += 1; return 'unexpected'; }
  });
  assert.deepEqual(result, { itemId: 'item-one', added: false });
  assert.equal(writes, 0);
});

test('ordinary creation writes exactly once', async () => {
  let writes = 0;
  const result = await addProjectItemWithReconciliation({
    findExisting: async () => null,
    addItem: async () => { writes += 1; return 'created'; }
  });
  assert.deepEqual(result, { itemId: 'created', added: true });
  assert.equal(writes, 1);
});

test('a conflict after remote commit is detected, never added twice', async () => {
  let existing = null;
  let writes = 0;
  const result = await addProjectItemWithReconciliation({
    findExisting: async () => existing,
    addItem: async () => {
      writes += 1;
      existing = 'committed-remotely';
      throw new Error('Your attempt to move this item created a temporary conflict.');
    },
    sleep: async () => { throw new Error('should not sleep'); }
  });
  assert.deepEqual(result, { itemId: 'committed-remotely', added: false });
  assert.equal(writes, 1);
});

test('transient conflict retries only after checking remote state', async () => {
  let writes = 0;
  let reads = 0;
  const pauses = [];
  const result = await addProjectItemWithReconciliation({
    findExisting: async () => { reads += 1; return null; },
    addItem: async () => {
      writes += 1;
      if (writes === 1) throw new Error('Your attempt to move this item created a temporary conflict.');
      return 'created-on-retry';
    },
    sleep: async (ms) => pauses.push(ms),
    delays: [10]
  });
  assert.deepEqual(result, { itemId: 'created-on-retry', added: true });
  assert.equal(writes, 2);
  assert.equal(reads, 3);
  assert.deepEqual(pauses, [10]);
});

test('permanent errors are not retried', async () => {
  let writes = 0;
  await assert.rejects(
    addProjectItemWithReconciliation({
      findExisting: async () => null,
      addItem: async () => { writes += 1; throw new Error('Resource not accessible by integration'); },
      sleep: async () => { throw new Error('unexpected sleep'); }
    }),
    /Resource not accessible/
  );
  assert.equal(writes, 1);
});

test('bounded retries fail visibly instead of reporting an imported item', async () => {
  let writes = 0;
  await assert.rejects(
    addProjectItemWithReconciliation({
      findExisting: async () => null,
      addItem: async () => {
        writes += 1;
        throw new Error('Your attempt to move this item created a temporary conflict.');
      },
      sleep: async () => {},
      delays: [0, 0]
    }),
    /unresolved after bounded retries/
  );
  assert.equal(writes, 3);
});

test('invalid invocation fails before mutation', async () => {
  await assert.rejects(
    addProjectItemWithReconciliation({ findExisting: async () => null, addItem: async () => '', delays: [-1] }),
    /nonnegative/
  );
});
