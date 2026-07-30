// Shared by the command-bar "Report a Bug" link and the footer email link —
// same address, same preset subject/body, one place to update (see
// Blueprint/10-tech-debt-backlog.md, "Кнопка Report a Bug" — the address
// itself is a known pre-release TODO, not this constant's concern).
export const BUG_REPORT_EMAIL = 'snaiperlod19@gmail.com';

export const BUG_REPORT_MAILTO_HREF = `mailto:${BUG_REPORT_EMAIL}?subject=${encodeURIComponent(
  'DotaDraft Bug Report',
)}&body=${encodeURIComponent('Describe what happened:\n\n\n(feel free to include the page URL and any other details)')}`;
