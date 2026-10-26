/**
 * Recover only known transient GitHub Projects V2 item conflicts.
 *
 * A mutation may succeed even if GitHub returns a conflict. Before any retry,
 * check the Project's current state; never retry an unknown GraphQL failure.
 * This module is agnostic to repository/owner/token and can be unit tested
 * without network or runner context.
 */
export function isTransientProjectItemConflict(error) {
  const message = String(error?.message ?? error);
  return /your attempt to move this item created a temporary conflict|already exists in (?:the )?project|item (?:has )?already been added/i.test(message);
}

export async function addProjectItemWithReconciliation({
  findExisting,
  addItem,
  sleep = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds)),
  delays = [250, 750, 1500]
}) {
  if (typeof findExisting !== 'function' || typeof addItem !== 'function') {
    throw new TypeError('findExisting and addItem must be functions.');
  }
  if (!Array.isArray(delays) || delays.some((delay) => !Number.isInteger(delay) || delay < 0)) {
    throw new TypeError('delays must be an array of nonnegative integer milliseconds.');
  }

  const initial = await findExisting();
  if (initial) return { itemId: initial, added: false };

  for (let attempt = 0; attempt <= delays.length; attempt += 1) {
    try {
      const itemId = await addItem();
      if (!itemId) throw new Error('GitHub did not return the newly added Project item id.');
      return { itemId, added: true };
    } catch (error) {
      if (!isTransientProjectItemConflict(error)) throw error;

      // The remote mutation may have committed despite the GraphQL error.
      const afterError = await findExisting();
      if (afterError) return { itemId: afterError, added: false };
      if (attempt === delays.length) {
        throw new Error(
          'GitHub Projects item conflict remained unresolved after bounded retries; ' +
            'rerun the idempotent AppFactory reconciliation.',
          { cause: error }
        );
      }

      await sleep(delays[attempt]);
      // Another parallel lane might have added the item while we waited.
      const afterBackoff = await findExisting();
      if (afterBackoff) return { itemId: afterBackoff, added: false };
    }
  }
}
