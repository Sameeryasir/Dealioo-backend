import {
  Body,
  Container,
  Head,
  Heading,
  Html,
  Img,
  Preview,
  Section,
  Text,
} from '@react-email/components';
import * as React from 'react';
import {
  DEALIOO_EMAIL_BLUE,
  DEALIOO_EMAIL_BLUE_SOFT,
  DEALIOO_EMAIL_INK,
  DEALIOO_EMAIL_LOGO_HEIGHT,
  DEALIOO_EMAIL_LOGO_URL,
  DEALIOO_EMAIL_LOGO_WIDTH,
  DEALIOO_EMAIL_MUTED,
  DEALIOO_EMAIL_DARK_MODE_STYLE,
} from './dealioo-email-brand';

export type OtpEmailProps = {
  name: string;
  email: string;
  code: string;
  expiresInMinutes: number;
};

export function OtpEmail({
  name,
  email,
  code,
  expiresInMinutes,
}: OtpEmailProps) {
  const minuteLabel = expiresInMinutes === 1 ? 'minute' : 'minutes';
  const greetingName = name?.trim() || email.split('@')[0] || 'there';

  return (
    <Html>
      <Head>
        <meta name="viewport" content="width=device-width, initial-scale=1.0" />
        <meta name="color-scheme" content="light dark" />
        <meta name="supported-color-schemes" content="light dark" />
        <style
          dangerouslySetInnerHTML={{
            __html: `
${DEALIOO_EMAIL_DARK_MODE_STYLE}
/* 2xl — very large viewports */
@media only screen and (min-width: 1536px) {
  .email-body { padding: 56px 40px 80px !important; }
  .email-title { font-size: 32px !important; line-height: 40px !important; }
  .email-code { font-size: 20px !important; padding: 18px 40px !important; }
}
/* xl — large desktops */
@media only screen and (min-width: 1280px) and (max-width: 1535px) {
  .email-body { padding: 52px 32px 72px !important; }
  .email-title { font-size: 30px !important; line-height: 38px !important; }
  .email-code { font-size: 19px !important; padding: 17px 36px !important; }
}
/* lg — laptops / small desktops */
@media only screen and (max-width: 1024px) {
  .email-body { padding: 44px 28px 60px !important; }
  .email-title { font-size: 28px !important; line-height: 36px !important; }
}
/* md — tablets */
@media only screen and (max-width: 768px) {
  .email-body { padding: 36px 22px 52px !important; }
  .email-title { font-size: 26px !important; line-height: 32px !important; }
  .email-code { font-size: 17px !important; padding: 15px 28px !important; }
}
/* sm — large phones */
@media only screen and (max-width: 640px) {
  .email-body { padding: 32px 18px 44px !important; }
  .email-container { width: 100% !important; max-width: 100% !important; }
  .email-title { font-size: 24px !important; line-height: 30px !important; }
  .email-code { font-size: 16px !important; letter-spacing: 0.1em !important; padding: 14px 24px !important; }
}
/* xs — small phones */
@media only screen and (max-width: 480px) {
  .email-body { padding: 24px 14px 36px !important; }
  .email-title { font-size: 22px !important; line-height: 28px !important; }
  .email-code { font-size: 15px !important; letter-spacing: 0.08em !important; padding: 12px 18px !important; }
}
`,
          }}
        />
      </Head>
      <Preview>
        {`Your verification code — expires in ${expiresInMinutes} ${minuteLabel}`}
      </Preview>
      <Body className="email-body" style={main}>
        <Container className="email-container" style={container}>
          <Section style={brandRow}>
            <Img
              src={DEALIOO_EMAIL_LOGO_URL}
              alt="Dealioo"
              width={DEALIOO_EMAIL_LOGO_WIDTH}
              height={DEALIOO_EMAIL_LOGO_HEIGHT}
              style={brandLogo}
            />
          </Section>

          <Heading as="h1" className="email-title dealioo-email-title" style={title}>
            Verify Otp
          </Heading>

          <Text className="dealioo-email-greeting" style={greeting}>
            Hi {greetingName},
          </Text>

          <Text className="dealioo-email-body" style={body}>
            Welcome to Dealioo. Please confirm your email address using the
            code below to activate your session and keep your account secure.
          </Text>

          <Text className="dealioo-email-body" style={body}>
            Enter this verification code where you left off:
          </Text>

          <Section style={codeButtonWrap}>
            <Text className="email-code" style={codeButton}>
              {code}
            </Text>
          </Section>

          <Text className="dealioo-email-meta" style={meta}>
            This code expires in {expiresInMinutes} {minuteLabel}. Do not share
            it with anyone.
          </Text>

          <Text className="dealioo-email-meta" style={disclaimer}>
            If you didn&apos;t request this code, you can safely ignore this
            message.
          </Text>

          <Text className="dealioo-email-signoff-bold" style={signoffBold}>
            Best regards,
          </Text>
          <Text className="dealioo-email-signoff-team" style={signoffTeam}>
            Dealioo Team
          </Text>
        </Container>
      </Body>
    </Html>
  );
}

const main = {
  backgroundColor: DEALIOO_EMAIL_BLUE_SOFT,
  margin: 0,
  padding: '48px 24px 64px',
  width: '100%',
  WebkitTextSizeAdjust: '100%' as const,
  textSizeAdjust: '100%' as const,
  fontFamily:
    'ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif',
};

const container = {
  margin: '0 auto',
  width: '100%',
  maxWidth: '560px',
  boxSizing: 'border-box' as const,
  backgroundColor: '#ffffff',
  border: '1px solid #e8edf5',
  borderRadius: '16px',
  padding: '32px 28px 36px',
};

const brandRow = {
  marginBottom: '32px',
  padding: '0',
};

const brandLogo = {
  display: 'block' as const,
  border: '0',
  outline: 'none',
  textDecoration: 'none',
};

const title = {
  color: DEALIOO_EMAIL_INK,
  fontSize: '28px',
  fontWeight: 700,
  lineHeight: '36px',
  letterSpacing: '-0.02em',
  margin: '0 0 28px',
  textAlign: 'left' as const,
  wordBreak: 'break-word' as const,
};

const greeting = {
  color: DEALIOO_EMAIL_INK,
  fontSize: '16px',
  lineHeight: '24px',
  fontWeight: 400,
  margin: '0 0 20px',
  textAlign: 'left' as const,
};

const body = {
  color: DEALIOO_EMAIL_MUTED,
  fontSize: '16px',
  lineHeight: '26px',
  fontWeight: 400,
  margin: '0 0 20px',
  textAlign: 'left' as const,
  wordBreak: 'break-word' as const,
};

const codeButtonWrap = {
  margin: '28px 0 24px',
};

const codeButton = {
  display: 'inline-block',
  backgroundColor: DEALIOO_EMAIL_BLUE,
  color: '#ffffff',
  fontSize: '18px',
  fontWeight: 700,
  letterSpacing: '0.12em',
  fontFamily:
    'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace',
  lineHeight: '1',
  margin: 0,
  padding: '16px 36px',
  borderRadius: '999px',
  textAlign: 'center' as const,
  maxWidth: '100%',
  boxSizing: 'border-box' as const,
  wordBreak: 'break-all' as const,
};

const meta = {
  color: DEALIOO_EMAIL_MUTED,
  fontSize: '15px',
  lineHeight: '24px',
  margin: '0 0 32px',
  textAlign: 'left' as const,
};

const disclaimer = {
  color: DEALIOO_EMAIL_MUTED,
  fontSize: '15px',
  lineHeight: '24px',
  margin: '0 0 40px',
  textAlign: 'left' as const,
};

const signoffBold = {
  color: DEALIOO_EMAIL_INK,
  fontSize: '15px',
  fontWeight: 700,
  lineHeight: '24px',
  margin: '0 0 4px',
  textAlign: 'left' as const,
};

const signoffTeam = {
  color: DEALIOO_EMAIL_BLUE,
  fontSize: '15px',
  fontWeight: 400,
  lineHeight: '24px',
  margin: 0,
  textAlign: 'left' as const,
};
