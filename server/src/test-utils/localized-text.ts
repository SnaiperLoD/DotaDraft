import type { LocalizedLine } from 'shared';

export function flattenLocalized(lines: LocalizedLine[]): string {
  return lines
    .map((l) => (typeof l === 'string' ? l : [l.key, ...Object.values(l.params ?? {})].join(' ')))
    .join(' ');
}
