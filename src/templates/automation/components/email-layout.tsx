import {
  Body,
  Button,
  Container,
  Head,
  Heading,
  Html,
  Preview,
  Section,
  Text,
} from '@react-email/components';
import * as React from 'react';
import {
  automationBody,
  automationBrandName,
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
  children?: React.ReactNode;
};

export function AutomationEmailLayout({
  preview,
  title,
  customerName,
  paragraphs,
  ctaLabel,
  ctaUrl,
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
            <Text style={automationBrandName}>Only Deals</Text>
          </Section>

          <Heading as="h1" style={automationTitle}>
            {title}
          </Heading>

          <Text style={automationGreeting}>Hi {greetingName},</Text>

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
          <Text style={automationSignoffTeam}>Only Deals Team</Text>
        </Container>
      </Body>
    </Html>
  );
}
