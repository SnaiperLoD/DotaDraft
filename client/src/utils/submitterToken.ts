const STORAGE_KEY = 'dotadraft.submitterToken';

// Protocol name must stay in sync with shared/constants/owner-token.ts.
// Inlined on the client because Vite's CJS prebundle of `shared` has dropped
// the named export: `[undefined]: token` sends header "undefined", Nest 401s
// with "Missing owner token". Captains Mode is the first POST that requires it
// (draft pool does not), so that's where it shows up.
export const OWNER_TOKEN_HEADER = 'X-Owner-Token';

// Anonymous, account-free identifier for draft ownership, Opponent Pool
// commits, and Battle pulls (see Blueprint/06-battle-engine.md and
// 12-next-session-priorities.md). Same UUID is sent as X-Owner-Token on
// every API request. Not an identity system.
export function getSubmitterToken(): string {
  let token = localStorage.getItem(STORAGE_KEY);
  if (!token) {
    token = crypto.randomUUID();
    localStorage.setItem(STORAGE_KEY, token);
  }
  return token;
}
