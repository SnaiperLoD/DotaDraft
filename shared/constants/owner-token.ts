// Header the client sends on every API request. Same UUID already stored
// as `dotadraft.submitterToken` — one anonymous browser identity for draft
// ownership, pool commits, and Battle pulls. Not an account.
export const OWNER_TOKEN_HEADER = 'X-Owner-Token';
