// Structured copy for client i18n (BattleStory pattern). Legacy History /
// older API payloads may still store plain English strings — clients must
// accept both via LocalizedLine.

export interface I18nLine {
  key: string;
  params?: Record<string, string>;
}

export type LocalizedLine = string | I18nLine;

export function isI18nLine(value: LocalizedLine): value is I18nLine {
  return typeof value === 'object' && value !== null && typeof value.key === 'string';
}

export function i18nLine(key: string, params?: Record<string, string>): I18nLine {
  return params && Object.keys(params).length > 0 ? { key, params } : { key };
}
