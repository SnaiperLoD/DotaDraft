import i18n from '../i18n';

export async function parseApiError(res: Response): Promise<string> {
  const text = await res.text();
  try {
    const json = JSON.parse(text) as { message?: unknown };
    if (typeof json.message === 'string' && json.message.trim()) return json.message;
    if (Array.isArray(json.message) && json.message.every((m) => typeof m === 'string')) {
      return json.message.join(', ');
    }
  } catch {
    /* raw body */
  }
  if (res.status === 429) return i18n.t('api.tooManyRequests');
  if (res.status === 503) return i18n.t('api.poolOffline');
  if (res.status === 401) return i18n.t('api.missingToken');
  return text.trim() || i18n.t('api.requestFailed', { status: res.status });
}
