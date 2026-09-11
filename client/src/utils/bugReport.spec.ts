import { describe, expect, it } from 'vitest';
import { BUG_REPORT_EMAIL, bugReportMailtoHref } from './bugReport';

describe('bugReportMailtoHref', () => {
  it('points at the pre-release inbox and appends URL diagnostics', () => {
    const href = bugReportMailtoHref('en');
    expect(href.startsWith(`mailto:${BUG_REPORT_EMAIL}?`)).toBe(true);
    const decoded = decodeURIComponent(href);
    expect(decoded).toContain('URL: ');
    expect(decoded).toContain('Lang: ');
    expect(decoded).toContain('UA: ');
  });
});
