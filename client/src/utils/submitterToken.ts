const STORAGE_KEY = 'dotadraft.submitterToken';

// Anonymous, account-free identifier for Opponent Pool commits/battles (see
// Blueprint/06-battle-engine.md Implementation Decisions) — just a loose
// anti-abuse handle, not an identity system.
export function getSubmitterToken(): string {
  let token = localStorage.getItem(STORAGE_KEY);
  if (!token) {
    token = crypto.randomUUID();
    localStorage.setItem(STORAGE_KEY, token);
  }
  return token;
}
