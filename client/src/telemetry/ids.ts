import { getSubmitterToken } from '../utils/submitterToken';

const SESSION_KEY = 'dotadraft.telemetry.sessionId';
const VISITOR_KEY = 'dotadraft.telemetry.visitorId';

function bytesToHex(bytes: ArrayBuffer): string {
  return [...new Uint8Array(bytes)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

async function sha256Short(value: string, length = 16): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return bytesToHex(digest).slice(0, length);
}

export function getSessionId(): string {
  let id = sessionStorage.getItem(SESSION_KEY);
  if (!id) {
    id = crypto.randomUUID();
    sessionStorage.setItem(SESSION_KEY, id);
  }
  return id;
}

// Truncated hash of the anonymous submitter token — never the raw token.
let visitorIdPromise: Promise<string> | null = null;

export function getVisitorId(): Promise<string> {
  if (!visitorIdPromise) {
    visitorIdPromise = (async () => {
      const cached = localStorage.getItem(VISITOR_KEY);
      if (cached) return cached;
      const id = await sha256Short(getSubmitterToken());
      localStorage.setItem(VISITOR_KEY, id);
      return id;
    })();
  }
  return visitorIdPromise;
}

export async function hashDraftId(draftId: string): Promise<string> {
  return sha256Short(draftId);
}
