const STORAGE_KEY = 'dotadraft.submitterToken';

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
