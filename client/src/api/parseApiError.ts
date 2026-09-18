import i18n from '../i18n';

type ApiErrorBody = {
  message?: unknown;
  requestId?: unknown;
};

export function readRequestId(res: Response, body?: ApiErrorBody): string | null {
  const fromHeader = res.headers.get('X-Request-Id')?.trim();
  if (fromHeader) return fromHeader;
  if (typeof body?.requestId === 'string' && body.requestId.trim()) return body.requestId.trim();
  return null;
}

function messageFromBody(json: ApiErrorBody): string | null {
  if (typeof json.message === 'string' && json.message.trim()) return json.message;
  if (Array.isArray(json.message) && json.message.every((m) => typeof m === 'string')) {
    return json.message.join(', ');
  }
  return null;
}

export async function parseApiError(res: Response): Promise<string> {
  const text = await res.text();
  try {
    const json = JSON.parse(text) as ApiErrorBody;
    const message = messageFromBody(json);
    if (message) return message;
  } catch {
    /* raw body */
  }
  if (res.status === 429) return i18n.t('api.tooManyRequests');
  if (res.status === 503) return i18n.t('api.poolOffline');
  if (res.status === 401) return i18n.t('api.missingToken');
  return text.trim() || i18n.t('api.requestFailed', { status: res.status });
}
