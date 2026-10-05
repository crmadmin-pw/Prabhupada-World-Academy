export const BV_DELETE_CONFIRMATION = 'DELETE BV GROUPS';

/** Never prefill or synthesize the person's confirmation. The API verifies it too. */
export function confirmBvGroupDeletion(
  deleteAll: boolean,
  prompt: (message: string) => string | null = message => window.prompt(message),
): typeof BV_DELETE_CONFIRMATION {
  const scope = deleteAll ? 'ALL Bhakti Vriksha groups and memberships' : 'the selected Bhakti Vriksha groups and their memberships';
  const answer = prompt(`This permanently deletes ${scope}. This cannot be undone.\n\nType ${BV_DELETE_CONFIRMATION} to confirm:`);
  if (answer !== BV_DELETE_CONFIRMATION) throw new Error('Deletion cancelled: confirmation phrase did not match.');
  return answer;
}
