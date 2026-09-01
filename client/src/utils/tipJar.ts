// Optional Ko-fi / tip link. Override with VITE_TIP_JAR_URL in client/.env
// (or root .env loaded by Vite). Set to "false" to hide the link entirely.
const DEFAULT_TIP_JAR_URL = 'https://ko-fi.com/snaiperlod';

export function tipJarUrl(): string | null {
  const raw = import.meta.env.VITE_TIP_JAR_URL;
  if (raw === 'false' || raw === '0') return null;
  if (typeof raw === 'string' && raw.trim()) return raw.trim();
  return DEFAULT_TIP_JAR_URL;
}
