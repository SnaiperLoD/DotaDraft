const STORAGE_KEY = 'dotadraft.submitterToken';
export const CAPTAINS_SESSION_KEY = 'dotadraft.captains-id';
export const TI_RUN_SESSION_KEY = 'ti-run-id';

const OWNER_SCOPED_KEYS = [CAPTAINS_SESSION_KEY, TI_RUN_SESSION_KEY] as const;

// Protocol name must stay in sync with shared/constants/owner-token.ts.
// Inlined on the client because Vite's CJS prebundle of `shared` has dropped
// the named export: `[undefined]: token` sends header "undefined", Nest 401s
// with "Missing owner token". Captains Mode is the first POST that requires it
// (draft pool does not), so that's where it shows up.
export const OWNER_TOKEN_HEADER = 'X-Owner-Token';

// Anonymous UUID for draft ownership, Opponent Pool commits, and Battle
// pulls. Optional accounts claim this same UUID as User.ownerToken.
export function getSubmitterToken(): string {
  let token = localStorage.getItem(STORAGE_KEY);
  if (!token) {
    token = crypto.randomUUID();
    localStorage.setItem(STORAGE_KEY, token);
  }
  return token;
}

export function setSubmitterToken(token: string): boolean {
  const next = token.trim();
  if (!next || next.length > 128) return false;
  const prev = localStorage.getItem(STORAGE_KEY);
  localStorage.setItem(STORAGE_KEY, next);
  if (prev && prev !== next) {
    for (const key of OWNER_SCOPED_KEYS) localStorage.removeItem(key);
    return true;
  }
  return false;
}
