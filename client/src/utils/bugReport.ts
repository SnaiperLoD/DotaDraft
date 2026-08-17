import i18n from '../i18n';

// Shared by the command-bar "Report a Bug" link and the footer email link —
// same address, same preset subject/body, one place to update (see
// Blueprint/10-tech-debt-backlog.md, "Кнопка Report a Bug" — the address
// itself is a known pre-release TODO, not this constant's concern).
export const BUG_REPORT_EMAIL = 'snaiperlod19@gmail.com';

export function bugReportMailtoHref(lng?: string): string {
  const t = i18n.getFixedT(lng ?? i18n.language);
  return `mailto:${BUG_REPORT_EMAIL}?subject=${encodeURIComponent(
    t('bugReport.subject'),
  )}&body=${encodeURIComponent(t('bugReport.body'))}`;
}
