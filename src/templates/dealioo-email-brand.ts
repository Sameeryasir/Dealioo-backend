export const DEALIOO_EMAIL_LOGO_URL =
  'https://dealioo-assests.nyc3.cdn.digitaloceanspaces.com/brand/dealioo-email-icon.png';

export const DEALIOO_EMAIL_LOGO_WIDTH = 48;
export const DEALIOO_EMAIL_LOGO_HEIGHT = 53;

export const DEALIOO_EMAIL_BLUE = '#1877f2';
export const DEALIOO_EMAIL_BLUE_DARK = '#0f5ed7';
export const DEALIOO_EMAIL_BLUE_SOFT = '#e8f2ff';
export const DEALIOO_EMAIL_INK = '#07111f';
export const DEALIOO_EMAIL_MUTED = '#475569';

export const DEALIOO_EMAIL_DARK_MODE_STYLE = `
:root { color-scheme: light dark; supported-color-schemes: light dark; }
@media (prefers-color-scheme: dark) {
  .dealioo-email-signoff-bold { color: #f8fafc !important; }
  .dealioo-email-signoff-team { color: #93c5fd !important; }
  .dealioo-email-title { color: #f8fafc !important; }
  .dealioo-email-greeting { color: #f1f5f9 !important; }
  .dealioo-email-body { color: #cbd5e1 !important; }
  .dealioo-email-meta { color: #94a3b8 !important; }
}
[data-ogsc] .dealioo-email-signoff-bold,
[data-ogsb] .dealioo-email-signoff-bold { color: #f8fafc !important; }
[data-ogsc] .dealioo-email-signoff-team,
[data-ogsb] .dealioo-email-signoff-team { color: #93c5fd !important; }
[data-ogsc] .dealioo-email-title,
[data-ogsb] .dealioo-email-title { color: #f8fafc !important; }
[data-ogsc] .dealioo-email-greeting,
[data-ogsb] .dealioo-email-greeting { color: #f1f5f9 !important; }
[data-ogsc] .dealioo-email-body,
[data-ogsb] .dealioo-email-body { color: #cbd5e1 !important; }
[data-ogsc] .dealioo-email-meta,
[data-ogsb] .dealioo-email-meta { color: #94a3b8 !important; }
`;
