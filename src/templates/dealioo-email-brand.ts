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
:root { color-scheme: light only; supported-color-schemes: light; }
html, body, .dealioo-email-root {
  background-color: #ffffff !important;
}
@media (prefers-color-scheme: dark) {
  html, body, .dealioo-email-root, .dealioo-email-card {
    background-color: #ffffff !important;
  }
  .dealioo-email-signoff-bold { color: #07111f !important; }
  .dealioo-email-signoff-team { color: #1877f2 !important; }
  .dealioo-email-title { color: #07111f !important; }
  .dealioo-email-greeting { color: #07111f !important; }
  .dealioo-email-body { color: #475569 !important; }
  .dealioo-email-meta { color: #475569 !important; }
}
[data-ogsc] html, [data-ogsb] html,
[data-ogsc] body, [data-ogsb] body,
[data-ogsc] .dealioo-email-root, [data-ogsb] .dealioo-email-root,
[data-ogsc] .dealioo-email-card, [data-ogsb] .dealioo-email-card {
  background-color: #ffffff !important;
}
[data-ogsc] .dealioo-email-signoff-bold,
[data-ogsb] .dealioo-email-signoff-bold { color: #07111f !important; }
[data-ogsc] .dealioo-email-signoff-team,
[data-ogsb] .dealioo-email-signoff-team { color: #1877f2 !important; }
[data-ogsc] .dealioo-email-title,
[data-ogsb] .dealioo-email-title { color: #07111f !important; }
[data-ogsc] .dealioo-email-greeting,
[data-ogsb] .dealioo-email-greeting { color: #07111f !important; }
[data-ogsc] .dealioo-email-body,
[data-ogsb] .dealioo-email-body { color: #475569 !important; }
[data-ogsc] .dealioo-email-meta,
[data-ogsb] .dealioo-email-meta { color: #94a3b8 !important; }
`;
