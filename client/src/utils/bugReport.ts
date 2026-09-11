import i18n from '../i18n';

// Shared by the command-bar "Report a Bug" link and the footer email link —
// same address, same preset subject/body. The inbox is still Nick's until
// a public alias exists (Blueprint/10-tech-debt-backlog.md, Report-a-bug).
export const BUG_REPORT_EMAIL = 'snaiperlod19@gmail.com';

export function bugReportDiagnostics(): string {
  if (typeof window === 'undefined') return '';
  return [`URL: ${window.location.href}`, `Lang: ${i18n.language}`, `UA: ${navigator.userAgent}`].join('\n');
}

export function bugReportMailtoHref(lng?: string): string {
  const t = i18n.getFixedT(lng ?? i18n.language);
  const diag = bugReportDiagnostics();
  const body = diag ? `${t('bugReport.body')}\n\n---\n${diag}` : t('bugReport.body');
  return `mailto:${BUG_REPORT_EMAIL}?subject=${encodeURIComponent(
    t('bugReport.subject'),
  )}&body=${encodeURIComponent(body)}`;
}
