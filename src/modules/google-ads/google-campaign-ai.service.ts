import {
  BadRequestException,
  Inject,
  Injectable,
  ServiceUnavailableException,
} from '@nestjs/common';
import {
  AI_PROVIDER,
  type AiProvider,
} from '../ai/interfaces/ai-provider.interface';

export type GoogleKeywordAiResult = {
  keywords: string[];
  negativeKeywords: string[];
};

@Injectable()
export class GoogleCampaignAiService {
  constructor(@Inject(AI_PROVIDER) private readonly aiProvider: AiProvider) {}

  async generateKeywords(input: {
    productsServices: string[];
    businessName?: string;
    businessCategory?: string;
    goal?: string | null;
    goalLabel?: string;
    idealCustomers?: string[];
    ageRanges?: string[];
    gender?: string;
    interests?: string[];
    locationHint?: string;
  }): Promise<GoogleKeywordAiResult> {
    const products = input.productsServices
      .map((row) => row.trim())
      .filter(Boolean);
    if (products.length === 0) {
      throw new BadRequestException('Add at least one product or service.');
    }

    const idealCustomers = (input.idealCustomers ?? [])
      .map((row) => row.trim())
      .filter(Boolean);
    const ageRanges = (input.ageRanges ?? [])
      .map((row) => row.trim())
      .filter(Boolean);
    const interests = (input.interests ?? [])
      .map((row) => row.trim())
      .filter(Boolean);
    const goalLabel =
      input.goalLabel?.trim() || input.goal?.trim() || 'Leads';
    const gender = input.gender?.trim() || 'ALL';

    const prompt = [
      'Give me keywords for this Google campaign.',
      'Match the campaign goal and the people being targeted.',
      '',
      'The user entered these products/services/keywords:',
      products.map((row) => `- ${row}`).join('\n'),
      '',
      'Campaign goal:',
      `- ${goalLabel}`,
      '',
      'Target customers:',
      idealCustomers.length > 0
        ? idealCustomers.map((row) => `- ${row}`).join('\n')
        : '- Not specified',
      `Age ranges: ${ageRanges.length > 0 ? ageRanges.join(', ') : 'Not specified'}`,
      `Gender: ${gender === 'ALL' ? 'All genders' : gender}`,
      interests.length > 0
        ? `Interests: ${interests.slice(0, 12).join(', ')}`
        : 'Interests: Not specified',
      '',
      'Business context:',
      `Business name: ${input.businessName?.trim() || 'Unknown'}`,
      `Category: ${input.businessCategory?.trim() || 'General'}`,
      '',
      'Return ONLY valid JSON with this exact shape:',
      '{"keywords":["string"],"negativeKeywords":["string"]}',
      'Rules:',
      '- keywords: exactly 6 or 7 search phrases',
      '- base them on the products/services AND tailor wording to the campaign goal and target customers',
      '- do NOT add locations, city names, regions, countries, or phrases like "near me"',
      '- do not invent unrelated products',
      '- keep each keyword under 80 characters',
      '- negativeKeywords: 4 to 6 terms to avoid (jobs, diy, free, salary, etc. when relevant)',
      '- no explanations, markdown, or code fences',
    ].join('\n');

    let raw: string;
    try {
      raw = await this.aiProvider.complete(prompt, {
        temperature: 0.4,
        maxTokens: 1024,
      });
    } catch (error) {
      if (error instanceof ServiceUnavailableException) throw error;
      const message =
        error instanceof Error ? error.message : 'AI keyword generation failed.';
      throw new ServiceUnavailableException(message);
    }

    const parsed = this.parseKeywordJson(raw);
    if (parsed.keywords.length === 0) {
      throw new ServiceUnavailableException(
        'AI returned no usable keywords. Please try again.',
      );
    }
    return {
      keywords: parsed.keywords
        .filter((keyword) => !/\bnear me\b/i.test(keyword))
        .slice(0, 7),
      negativeKeywords: parsed.negativeKeywords.slice(0, 6),
    };
  }

  private parseKeywordJson(raw: string): GoogleKeywordAiResult {
    const text = raw.trim();
    const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
    const candidate = (fenced?.[1] ?? text).trim();
    const start = candidate.indexOf('{');
    const end = candidate.lastIndexOf('}');
    if (start < 0 || end <= start) {
      return { keywords: [], negativeKeywords: [] };
    }

    try {
      const json = JSON.parse(candidate.slice(start, end + 1)) as {
        keywords?: unknown;
        negativeKeywords?: unknown;
      };
      return {
        keywords: this.normalizeList(json.keywords),
        negativeKeywords: this.normalizeList(json.negativeKeywords),
      };
    } catch {
      return { keywords: [], negativeKeywords: [] };
    }
  }

  private normalizeList(value: unknown): string[] {
    if (!Array.isArray(value)) return [];
    const out: string[] = [];
    for (const item of value) {
      if (typeof item !== 'string') continue;
      const cleaned = item.trim().replace(/\s+/g, ' ');
      if (!cleaned || cleaned.length > 80) continue;
      if (
        out.some((existing) => existing.toLowerCase() === cleaned.toLowerCase())
      ) {
        continue;
      }
      out.push(cleaned);
    }
    return out;
  }
}
