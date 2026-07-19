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
  children,
}: AutomationEmailLayoutProps) {
  const greetingName = customerName?.trim() || 'there';

  return (
    <Html>
      <Head />
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
            <Heading as="h1" style={automationTitle}>
              {title}
            </Heading>
          ) : null}

          {!skipGreeting ? (
            <Text style={automationGreeting}>Hi {greetingName},</Text>
          ) : null}

          {paragraphs.map((paragraph, index) => (
            <Text key={`p-${index}`} style={automationBody}>
              {paragraph}
            </Text>
          ))}

          {children}

          {ctaLabel && ctaUrl ? (
            <Section style={automationCtaWrap}>
              <Button href={ctaUrl} style={automationCtaButton}>
                {ctaLabel}
              </Button>
            </Section>
          ) : null}

          <Text style={automationSignoffBold}>Best regards,</Text>
          <Text style={automationSignoffTeam}>Dealioo Team</Text>
        </Container>
      </Body>
    </Html>
  );
}
