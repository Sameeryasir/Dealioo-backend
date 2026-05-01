import {
  Body,
  Container,
  Head,
  Heading,
  Html,
  Preview,
  Section,
  Text,
} from '@react-email/components';
import * as React from 'react';

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
        <meta name="color-scheme" content="light only" />
        <meta name="supported-color-schemes" content="light" />
        <style
          dangerouslySetInnerHTML={{
            __html: `
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
            <Text style={brandIcon}>◇</Text>
            <Text style={brandName}>Retention+</Text>
          </Section>

          <Heading as="h1" className="email-title" style={title}>
            Verify Otp
          </Heading>

          <Text style={greeting}>Hi {greetingName},</Text>

          <Text style={body}>
            Welcome to Retention. Please confirm your email address using the
            code below to activate your session and keep your account secure.
          </Text>

          <Text style={body}>
            Enter this verification code where you left off:
          </Text>

          <Section style={codeButtonWrap}>
            <Text className="email-code" style={codeButton}>
              {code}
            </Text>
          </Section>

          <Text style={meta}>
            This code expires in {expiresInMinutes} {minuteLabel}. Do not share
            it with anyone.
          </Text>

          <Text style={disclaimer}>
            If you didn&apos;t request this code, you can safely ignore this
            message.
          </Text>

          <Text style={signoffBold}>Best regards,</Text>
          <Text style={signoffTeam}>Retention+ Team</Text>
        </Container>
      </Body>
    </Html>
  );
}

const main = {
  backgroundColor: '#ffffff',
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
};

const brandRow = {
  marginBottom: '40px',
};

const brandIcon = {
  display: 'inline-block',
  color: '#000000',
  fontSize: '18px',
  lineHeight: '1',
  margin: '0 8px 0 0',
  verticalAlign: 'middle' as const,
};

const brandName = {
  display: 'inline-block',
  color: '#000000',
  fontSize: '15px',
  fontWeight: 700,
  letterSpacing: '-0.01em',
  margin: 0,
  verticalAlign: 'middle' as const,
};

const title = {
  color: '#000000',
  fontSize: '28px',
  fontWeight: 700,
  lineHeight: '36px',
  letterSpacing: '-0.02em',
  margin: '0 0 28px',
  textAlign: 'left' as const,
  wordBreak: 'break-word' as const,
};

const greeting = {
  color: '#000000',
  fontSize: '16px',
  lineHeight: '24px',
  fontWeight: 400,
  margin: '0 0 20px',
  textAlign: 'left' as const,
};

const body = {
  color: '#000000',
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
  backgroundColor: '#000000',
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
  color: '#000000',
  fontSize: '15px',
  lineHeight: '24px',
  margin: '0 0 32px',
  textAlign: 'left' as const,
};

const disclaimer = {
  color: '#000000',
  fontSize: '15px',
  lineHeight: '24px',
  margin: '0 0 40px',
  textAlign: 'left' as const,
};

const signoffBold = {
  color: '#000000',
  fontSize: '15px',
  fontWeight: 700,
  lineHeight: '24px',
  margin: '0 0 4px',
  textAlign: 'left' as const,
};

const signoffTeam = {
  color: '#000000',
  fontSize: '15px',
  fontWeight: 400,
  lineHeight: '24px',
  margin: 0,
  textAlign: 'left' as const,
};
