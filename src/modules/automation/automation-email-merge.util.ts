export function resolveAutomationFirstName(customerName: string): string {
  const trimmed = customerName.trim();
  if (!trimmed) {
    return 'there';
  }
  return trimmed.split(/\s+/)[0] || trimmed;
}

export function resolveAutomationLastName(customerName: string): string {
  const trimmed = customerName.trim();
  if (!trimmed) {
    return '';
  }
  const parts = trimmed.split(/\s+/).filter(Boolean);
  if (parts.length <= 1) {
    return '';
  }
  return parts[parts.length - 1] ?? '';
}

export function resolveAutomationFullName(customerName: string): string {
  const trimmed = customerName.trim();
  return trimmed || 'there';
}

export function interpolateAutomationEmailMessage(
  message: string,
  options: {
    customerName: string;
    paymentLink?: string;
    passLink?: string;
  },
): string {
  const fullName = resolveAutomationFullName(options.customerName);
  const lastName = resolveAutomationLastName(options.customerName);
  const paymentLink = options.paymentLink?.trim() ?? '';
  const passLink = options.passLink?.trim() ?? '';

  return message
    .replace(/\[Full Name\]/gi, fullName)
    .replace(/\[First Name\]/gi, fullName)
    .replace(/\[Last Name\]/gi, lastName || fullName)
    .replace(/\[Payment Link\]/gi, paymentLink)
    .replace(/\[Pass Link\]/gi, passLink);
}

export function splitAutomationEmailBody(message: string): string[] {
  const parts = message.includes('\n\n')
    ? message.split(/\n{2,}/)
    : message.split(/\n/);

  return parts.map((paragraph) => paragraph.trim()).filter(Boolean);
}
