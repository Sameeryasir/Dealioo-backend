import {
  Body,
  Button,
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
  DEALIOO_EMAIL_LOGO_HEIGHT,
  DEALIOO_EMAIL_LOGO_URL,
  DEALIOO_EMAIL_LOGO_WIDTH,
  DEALIOO_EMAIL_DARK_MODE_STYLE,
} from '../../dealioo-email-brand';
import {
  automationBody,
  automationBrandLogo,
  automationBrandRow,
  automationEmailContainer,
  automationCtaButton,
  automationCtaWrap,
  automationEmailMain,
  automationGreeting,
  automationSignoffBold,
  automationSignoffTeam,
  automationTitle,
} from './email-styles';

export type AutomationEmailLayoutProps = {
  preview: string;
  title: string;
  customerName: string;
  paragraphs: string[];
  ctaLabel?: string;
  ctaUrl?: string;
  skipTitle?: boolean;
  skipGreeting?: boolean;
  qrImageDataUrl?: string;
  children?: React.ReactNode;
};

export function AutomationEmailLayout({
  preview,
  title,
  customerName,
  paragraphs,
  ctaLabel,
  ctaUrl,
  skipTitle = false,
  skipGreeting = false,
  qrImageDataUrl,
  children,
}: AutomationEmailLayoutProps) {
  const greetingName = customerName?.trim() || 'there';

  return (
    <Html>
      <Head>
        <meta name="color-scheme" content="light dark" />
        <meta name="supported-color-schemes" content="light dark" />
        <style
          dangerouslySetInnerHTML={{ __html: DEALIOO_EMAIL_DARK_MODE_STYLE }}
        />
      </Head>
      <Preview>{preview}</Preview>
      <Body style={automationEmailMain}>
        <Container style={automationEmailContainer}>
          <Section style={automationBrandRow}>
            <Img
              src={DEALIOO_EMAIL_LOGO_URL}
              alt="Dealioo"
              width={DEALIOO_EMAIL_LOGO_WIDTH}
              height={DEALIOO_EMAIL_LOGO_HEIGHT}
              style={automationBrandLogo}
            />
          </Section>

          {!skipTitle ? (
            <Heading
              as="h1"
              className="dealioo-email-title"
              style={automationTitle}
            >
              {title}
            </Heading>
          ) : null}

          {!skipGreeting ? (
            <Text className="dealioo-email-greeting" style={automationGreeting}>
              Hi {greetingName},
            </Text>
          ) : null}

          {paragraphs.map((paragraph, index) => (
            <Text
              key={`p-${index}`}
              className="dealioo-email-body"
              style={automationBody}
            >
              {paragraph}
            </Text>
          ))}

          {qrImageDataUrl?.trim() ? (
            <Section style={{ textAlign: 'center' as const, margin: '24px 0' }}>
              <Img
                src={qrImageDataUrl.trim()}
                alt="Your coupon QR code"
                width={220}
                height={220}
                style={{
                  display: 'block',
                  margin: '0 auto',
                  border: '1px solid #e8edf5',
                  borderRadius: 12,
                }}
              />
              <Text
                className="dealioo-email-meta"
                style={{
                  ...automationBody,
                  marginTop: 12,
                  textAlign: 'center' as const,
                  fontSize: 13,
                  color: '#64748b',
                }}
              >
                Show this QR code at the business to redeem your offer.
              </Text>
            </Section>
          ) : null}

          {children}

          {ctaLabel && ctaUrl ? (
            <Section style={automationCtaWrap}>
              <Button
                href={ctaUrl}
                target="_blank"
                style={automationCtaButton}
              >
                {ctaLabel}
              </Button>
            </Section>
          ) : null}

          <Text
            className="dealioo-email-signoff-bold"
            style={automationSignoffBold}
          >
            Best regards,
          </Text>
          <Text
            className="dealioo-email-signoff-team"
            style={automationSignoffTeam}
          >
            Dealioo Team
          </Text>
        </Container>
      </Body>
    </Html>
  );
}
