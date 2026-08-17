export type DealiooInvoicePdfLine = {
  description: string;
  amount: string;
};

export type DealiooInvoicePdfInput = {
  number: string;
  issuedAt: string;
  status: string;
  billToName: string;
  billToEmail: string;
  billToAddress: string[];
  lines: DealiooInvoicePdfLine[];
  totalAmount: string;
};

export function buildDealiooInvoicePdf(input: DealiooInvoicePdfInput): Buffer {
  const pageWidth = 612;
  const pageHeight = 792;
  const margin = 48;
  const ops: string[] = [];

  const fill = (r: number, g: number, b: number) => {
    ops.push(`${r.toFixed(3)} ${g.toFixed(3)} ${b.toFixed(3)} rg`);
  };
  const rect = (x: number, y: number, w: number, h: number) => {
    ops.push(`${x} ${y} ${w} ${h} re f`);
  };
  const text = (
    font: 'F1' | 'F2',
    size: number,
    x: number,
    y: number,
    value: string,
  ) => {
    ops.push(
      `BT /${font} ${size} Tf 1 0 0 1 ${x.toFixed(2)} ${y.toFixed(2)} Tm (${escapePdfText(value)}) Tj ET`,
    );
  };
  const rightText = (
    font: 'F1' | 'F2',
    size: number,
    right: number,
    y: number,
    value: string,
  ) => {
    const width = estimateTextWidth(value, size, font === 'F2');
    text(font, size, right - width, y, value);
  };

  fill(0.094, 0.467, 0.949);
  rect(0, pageHeight - 72, pageWidth, 72);
  fill(1, 1, 1);
  text('F2', 22, margin, pageHeight - 46, 'Dealioo');
  rightText('F2', 16, pageWidth - margin, pageHeight - 46, 'Invoice');

  let y = pageHeight - 108;
  fill(0.07, 0.16, 0.29);
  text('F2', 11, margin, y, `Invoice ${pdfSafe(input.number)}`);
  y -= 18;
  fill(0.35, 0.42, 0.52);
  text('F1', 10, margin, y, `Date  ${pdfSafe(input.issuedAt)}`);
  y -= 14;
  text('F1', 10, margin, y, `Status  ${pdfSafe(input.status)}`);

  y -= 28;
  fill(0.07, 0.16, 0.29);
  text('F2', 11, margin, y, 'Bill to');
  y -= 16;
  fill(0.35, 0.42, 0.52);
  const billLines = [
    input.billToName,
    input.billToEmail,
    ...input.billToAddress,
  ]
    .map((line) => pdfSafe(line))
    .filter(Boolean);
  for (const line of billLines) {
    text('F1', 10, margin, y, line);
    y -= 14;
  }

  y -= 18;
  fill(0.094, 0.467, 0.949);
  rect(margin, y, pageWidth - margin * 2, 1.5);
  y -= 18;
  fill(0.07, 0.16, 0.29);
  text('F2', 10, margin, y, 'Description');
  rightText('F2', 10, pageWidth - margin, y, 'Amount');
  y -= 10;
  fill(0.90, 0.93, 0.96);
  rect(margin, y, pageWidth - margin * 2, 0.6);

  const descMax = 78;
  for (const line of input.lines) {
    const wrapped = wrapText(pdfSafe(line.description) || 'Subscription', descMax);
    y -= 16;
    fill(0.07, 0.16, 0.29);
    text('F1', 10, margin, y, wrapped[0] ?? 'Subscription');
    rightText('F1', 10, pageWidth - margin, y, pdfSafe(line.amount));
    for (const extra of wrapped.slice(1)) {
      y -= 13;
      fill(0.35, 0.42, 0.52);
      text('F1', 10, margin, y, extra);
    }
  }

  y -= 14;
  fill(0.90, 0.93, 0.96);
  rect(margin, y, pageWidth - margin * 2, 0.6);
  y -= 20;
  fill(0.07, 0.16, 0.29);
  text('F2', 11, margin, y, 'Total');
  rightText('F2', 12, pageWidth - margin, y, pdfSafe(input.totalAmount));

  fill(0.45, 0.51, 0.60);
  text(
    'F1',
    9,
    margin,
    40,
    'Thank you for your business. This invoice was issued by Dealioo.',
  );

  const stream = ops.join('\n');
  const streamBytes = Buffer.from(stream, 'latin1');

  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${pageWidth} ${pageHeight}] /Resources << /Font << /F1 4 0 R /F2 5 0 R >> >> /Contents 6 0 R >>`,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold >>',
    `<< /Length ${streamBytes.length} >>\nstream\n${stream}\nendstream`,
  ];

  let pdf = '%PDF-1.4\n';
  const offsets = [0];
  for (let i = 0; i < objects.length; i += 1) {
    offsets.push(Buffer.byteLength(pdf, 'latin1'));
    pdf += `${i + 1} 0 obj\n${objects[i]}\nendobj\n`;
  }
  const xrefOffset = Buffer.byteLength(pdf, 'latin1');
  pdf += `xref\n0 ${objects.length + 1}\n`;
  pdf += '0000000000 65535 f \n';
  for (let i = 1; i < offsets.length; i += 1) {
    pdf += `${String(offsets[i]).padStart(10, '0')} 00000 n \n`;
  }
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`;
  return Buffer.from(pdf, 'latin1');
}

function pdfSafe(value: string): string {
  return value
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/[\u201C\u201D]/g, '"')
    .replace(/[\u2013\u2014]/g, '-')
    .replace(/\u00A0/g, ' ')
    .replace(/[^\x20-\x7E]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function escapePdfText(value: string): string {
  return pdfSafe(value)
    .replace(/\\/g, '\\\\')
    .replace(/\(/g, '\\(')
    .replace(/\)/g, '\\)');
}

function estimateTextWidth(
  value: string,
  size: number,
  bold: boolean,
): number {
  return pdfSafe(value).length * size * (bold ? 0.55 : 0.5);
}

function wrapText(value: string, maxChars: number): string[] {
  const words = value.split(' ').filter(Boolean);
  if (words.length === 0) return [value];
  const lines: string[] = [];
  let current = '';
  for (const word of words) {
    const next = current ? `${current} ${word}` : word;
    if (next.length > maxChars && current) {
      lines.push(current);
      current = word;
    } else {
      current = next;
    }
  }
  if (current) lines.push(current);
  return lines;
}
