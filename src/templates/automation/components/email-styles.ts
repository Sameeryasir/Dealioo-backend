import {
  DEALIOO_EMAIL_BLUE,
  DEALIOO_EMAIL_BLUE_SOFT,
  DEALIOO_EMAIL_INK,
  DEALIOO_EMAIL_MUTED,
} from '../../dealioo-email-brand';

export const automationEmailMain = {
  backgroundColor: DEALIOO_EMAIL_BLUE_SOFT,
  margin: 0,
  padding: '48px 24px 64px',
  width: '100%',
  fontFamily:
    'ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif',
};

export const automationEmailContainer = {
  margin: '0 auto',
  width: '100%',
  maxWidth: '560px',
  boxSizing: 'border-box' as const,
  backgroundColor: '#ffffff',
  border: '1px solid #e8edf5',
  borderRadius: '16px',
  padding: '32px 28px 36px',
};

export const automationBrandRow = {
  marginBottom: '28px',
  padding: '0',
};

export const automationBrandLogo = {
  display: 'block',
  border: '0',
  outline: 'none',
  textDecoration: 'none',
};

export const automationTitle = {
  color: DEALIOO_EMAIL_INK,
  fontSize: '26px',
  fontWeight: 700,
  lineHeight: '34px',
  margin: '0 0 24px',
  textAlign: 'left' as const,
};

export const automationGreeting = {
  color: DEALIOO_EMAIL_INK,
  fontSize: '16px',
  lineHeight: '24px',
  margin: '0 0 16px',
};

export const automationBody = {
  color: DEALIOO_EMAIL_MUTED,
  fontSize: '16px',
  lineHeight: '26px',
  margin: '0 0 20px',
};

export const automationCtaWrap = {
  margin: '28px 0 24px',
};

export const automationCtaButton = {
  display: 'inline-block',
  backgroundColor: DEALIOO_EMAIL_BLUE,
  color: '#ffffff',
  fontSize: '15px',
  fontWeight: 600,
  padding: '14px 28px',
  borderRadius: '999px',
  textDecoration: 'none',
};

export const automationSignoffBold = {
  color: DEALIOO_EMAIL_INK,
  fontSize: '15px',
  fontWeight: 700,
  lineHeight: '24px',
  margin: '32px 0 4px',
};

export const automationSignoffTeam = {
  color: DEALIOO_EMAIL_BLUE,
  fontSize: '15px',
  lineHeight: '24px',
  margin: 0,
};
