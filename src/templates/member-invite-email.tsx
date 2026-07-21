import {
  Body,
  Container,
  Head,
  Heading,
  Html,
  Img,
  Link,
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

export type MemberInviteEmailProps = {
  businessName: string;
  inviterName: string;
  role: string;
  acceptUrl: string;
  expiresInDays: number;
  permissions?: string[];
};

export function MemberInviteEmail({
  businessName,
  inviterName,
  role,
  acceptUrl,
  expiresInDays,
  permissions = [],
}: MemberInviteEmailProps) {
  const dayLabel = expiresInDays === 1 ? 'day' : 'days';
  const permissionLine =
    permissions.length > 0
      ? permissions.map((permission) => permission.replace(/_/g, ' ')).join(', ')
      : null;

  return (
    <Html>
      <Head>
        <meta name="color-scheme" content="light dark" />
        <meta name="supported-color-schemes" content="light dark" />
        <style
          dangerouslySetInnerHTML={{ __html: DEALIOO_EMAIL_DARK_MODE_STYLE }}
        />
      </Head>
      <Preview>
        {inviterName} invited you to join {businessName} on RetentionPlus
      </Preview>
      <Body style={bodyStyle}>
        <Container style={containerStyle}>
          <Section style={brandRowStyle}>
            <Img
              src={DEALIOO_EMAIL_LOGO_URL}
              alt="Dealioo"
              width={DEALIOO_EMAIL_LOGO_WIDTH}
              height={DEALIOO_EMAIL_LOGO_HEIGHT}
              style={brandLogoStyle}
            />
          </Section>
          <Section style={cardStyle}>
            <Heading className="dealioo-email-title" style={headingStyle}>
              You&apos;re invited
            </Heading>
            <Text className="dealioo-email-body" style={textStyle}>
              <strong>{inviterName}</strong> invited you to join{' '}
              <strong>{businessName}</strong> as a <strong>{role}</strong>.
            </Text>
            {permissionLine ? (
              <Text className="dealioo-email-body" style={textStyle}>
                You will have access to: <strong>{permissionLine}</strong>.
              </Text>
            ) : null}
            <Text className="dealioo-email-body" style={textStyle}>
              Click the button below to accept the invitation. This link expires
              in {expiresInDays} {dayLabel}.
            </Text>
            <Link href={acceptUrl} style={buttonStyle}>
              Accept invitation
            </Link>
            <Text className="dealioo-email-meta" style={footerStyle}>
              If you did not expect this email, you can safely ignore it.
            </Text>
          </Section>
        </Container>
      </Body>
    </Html>
  );
}

const bodyStyle: React.CSSProperties = {
  backgroundColor: DEALIOO_EMAIL_BLUE_SOFT,
  fontFamily:
    '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif',
  margin: 0,
  padding: '32px 16px',
};

const containerStyle: React.CSSProperties = {
  margin: '0 auto',
  maxWidth: '560px',
};

const brandRowStyle: React.CSSProperties = {
  marginBottom: '16px',
  padding: '0',
};

const brandLogoStyle: React.CSSProperties = {
  display: 'block',
  border: '0',
  outline: 'none',
  textDecoration: 'none',
};

const cardStyle: React.CSSProperties = {
  backgroundColor: '#ffffff',
  border: '1px solid #e8edf5',
  borderRadius: '16px',
  padding: '28px 24px',
};

const headingStyle: React.CSSProperties = {
  color: DEALIOO_EMAIL_INK,
  fontSize: '24px',
  fontWeight: 700,
  lineHeight: '32px',
  margin: '0 0 16px',
};

const textStyle: React.CSSProperties = {
  color: DEALIOO_EMAIL_MUTED,
  fontSize: '15px',
  lineHeight: '24px',
  margin: '0 0 16px',
};

const buttonStyle: React.CSSProperties = {
  backgroundColor: DEALIOO_EMAIL_BLUE,
  borderRadius: '999px',
  color: '#ffffff',
  display: 'inline-block',
  fontSize: '15px',
  fontWeight: 600,
  padding: '12px 20px',
  textDecoration: 'none',
};

const footerStyle: React.CSSProperties = {
  color: '#94a3b8',
  fontSize: '13px',
  lineHeight: '20px',
  margin: '24px 0 0',
};
