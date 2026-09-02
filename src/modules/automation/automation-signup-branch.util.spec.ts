import {
  isParallelSplitConfig,
  parseClockTime,
  resolveWaitDelayMinutes,
  resolveWaitResumeAt,
} from './automation-wait.util';
import {
  collectSignupFilterConditions,
  parseSignupFilterCondition,
  shouldSkipSignupBranchOutboundEmail,
} from './automation-signup-filter.util';
import { AutomationPurpose } from '../../db/entities/automation-purpose.enum';

describe('automation-wait.util', () => {
  it('resolves relative delay minutes', () => {
    expect(resolveWaitDelayMinutes({ delay: 15, unit: 'minutes' })).toBe(15);
    expect(resolveWaitDelayMinutes({ delay: 2, unit: 'hours' })).toBe(120);
  });

  it('detects parallel split config', () => {
    expect(isParallelSplitConfig({ isParallelSplit: true, delay: 0 })).toBe(
      true,
    );
    expect(
      isParallelSplitConfig({
        branches: [{ id: 'a' }, { id: 'b' }],
      }),
    ).toBe(true);
    expect(isParallelSplitConfig({ delay: 15, unit: 'minutes' })).toBe(false);
  });

  it('parses clock times', () => {
    expect(parseClockTime({ time: '10:34' })).toEqual({
      hours: 10,
      minutes: 34,
    });
    expect(parseClockTime({ untilTime: '10:34 am' })).toEqual({
      hours: 10,
      minutes: 34,
    });
    expect(parseClockTime({ untilTime: '10:34 pm' })).toEqual({
      hours: 22,
      minutes: 34,
    });
  });

  it('schedules next-day until_time waits', () => {
    const now = new Date('2026-08-04T15:00:00');
    const resumeAt = resolveWaitResumeAt(
      {
        waitMode: 'until_time',
        untilTime: '10:34 am',
        time: '10:34',
        untilLabel: 'Next day at 10:34 AM',
      },
      now,
    );
    expect(resumeAt?.toISOString()).toBe(
      new Date('2026-08-05T10:34:00').toISOString(),
    );
  });

  it('schedules relative waits via resumeAt', () => {
    const now = new Date('2026-08-04T12:00:00Z');
    const resumeAt = resolveWaitResumeAt(
      { delay: 15, unit: 'minutes' },
      now,
    );
    expect(resumeAt?.getTime()).toBe(now.getTime() + 15 * 60_000);
  });
});

describe('automation-signup-filter.util', () => {
  it('collects conditions from array or conditionType', () => {
    expect(
      collectSignupFilterConditions({
        conditions: [{ value: 'Reward was redeemed', negated: true }],
      }),
    ).toHaveLength(1);
    expect(
      collectSignupFilterConditions({ conditionType: 'Pass not added' }),
    ).toEqual([{ value: 'Pass not added' }]);
  });

  it('parses wallet and reward filters', () => {
    expect(parseSignupFilterCondition({ value: 'Pass not added' })).toEqual({
      kind: 'pass_added',
      negated: true,
    });
    expect(
      parseSignupFilterCondition({
        negated: true,
        value: 'Reward was redeemed',
      }),
    ).toEqual({
      kind: 'reward_redeemed',
      negated: true,
    });
    expect(
      parseSignupFilterCondition({
        value: 'Over 7 hours since signed up for the first time',
      }),
    ).toEqual({
      kind: 'time_since_signup',
      negated: false,
      amount: 7,
      unit: 'hours',
      comparator: 'gte',
      hours: 7,
    });
    expect(
      parseSignupFilterCondition({
        value: 'Over 30 minutes since signed up for the first time',
        amount: 30,
        unit: 'minutes',
      }),
    ).toEqual({
      kind: 'time_since_signup',
      negated: false,
      amount: 30,
      unit: 'minutes',
      comparator: 'gte',
      hours: undefined,
    });
    expect(
      parseSignupFilterCondition({
        value: 'Offer expires in less than 6 days',
      }),
    ).toEqual({
      kind: 'offer_expires_within',
      negated: false,
      amount: 6,
      unit: 'days',
    });
    expect(
      parseSignupFilterCondition({
        value: 'Offer expires in less than 3 days',
        amount: 3,
        unit: 'days',
      }),
    ).toEqual({
      kind: 'offer_expires_within',
      negated: false,
      amount: 3,
      unit: 'days',
    });
  });

  it('parses post-follow-up branch filters (offer expiry + weekend pass)', () => {
    expect(
      parseSignupFilterCondition({
        value: 'Over a day since signed up for the first time',
      }),
    ).toEqual({
      kind: 'time_since_signup',
      negated: false,
      amount: 1,
      unit: 'days',
      comparator: 'gte',
      hours: undefined,
    });
    expect(
      parseSignupFilterCondition({
        value: 'Less than a week since signed up for the first time',
      }),
    ).toEqual({
      kind: 'time_since_signup',
      negated: false,
      amount: 7,
      unit: 'days',
      comparator: 'lt',
      hours: undefined,
    });
    expect(
      parseSignupFilterCondition({
        negated: true,
        value: '$4 Pretzel Bites was redeemed',
      }),
    ).toEqual({
      kind: 'reward_redeemed',
      negated: true,
    });
    expect(
      parseSignupFilterCondition({
        value: 'Offer expires in less than 6 days',
        amount: 6,
        unit: 'days',
      }),
    ).toEqual({
      kind: 'offer_expires_within',
      negated: false,
      amount: 6,
      unit: 'days',
    });
  });
});

describe('shouldSkipSignupBranchOutboundEmail', () => {
  it('allows enabled signup branches and skips the rest', () => {
    expect(
      shouldSkipSignupBranchOutboundEmail(AutomationPurpose.FUNNEL_SIGNUP, {
        message: 'Complete your signup — add your pass to your wallet.',
        linkLabel: 'Pass Link',
      }),
    ).toBe(false);
    expect(
      shouldSkipSignupBranchOutboundEmail(AutomationPurpose.FUNNEL_SIGNUP, {
        flowBranch: 'wallet_reminder',
        message: 'Reminder',
      }),
    ).toBe(false);
    expect(
      shouldSkipSignupBranchOutboundEmail(AutomationPurpose.FUNNEL_SIGNUP, {
        flowBranch: 'follow_up',
        message: 'Follow up',
      }),
    ).toBe(false);
    expect(
      shouldSkipSignupBranchOutboundEmail(AutomationPurpose.FUNNEL_SIGNUP, {
        flowBranch: 'offer_expiry',
        message: 'Expiry',
      }),
    ).toBe(false);
    expect(
      shouldSkipSignupBranchOutboundEmail(AutomationPurpose.FUNNEL_SIGNUP, {
        flowBranch: 'offer_expiry_3d',
        message: 'Expiry in 3 days',
      }),
    ).toBe(false);
    expect(
      shouldSkipSignupBranchOutboundEmail(AutomationPurpose.FUNNEL_SIGNUP, {
        flowBranch: 'offer_expiry_tomorrow',
        message: 'Expires tomorrow',
      }),
    ).toBe(false);
    expect(
      shouldSkipSignupBranchOutboundEmail(AutomationPurpose.FUNNEL_SIGNUP, {
        flowBranch: 'extend_offer',
        message: 'Extended',
      }),
    ).toBe(true);
    expect(
      shouldSkipSignupBranchOutboundEmail(AutomationPurpose.FUNNEL_SIGNUP, {
        flowBranch: 'why_didnt_come',
        message: 'Feedback',
      }),
    ).toBe(false);
    expect(
      shouldSkipSignupBranchOutboundEmail(AutomationPurpose.FUNNEL_SIGNUP, {
        flowBranch: 'weekend_pass',
        message: 'Weekend',
      }),
    ).toBe(false);
    expect(
      shouldSkipSignupBranchOutboundEmail(
        AutomationPurpose.FUNNEL_PAYMENT,
        { flowBranch: 'wallet_reminder' },
      ),
    ).toBe(false);
  });

  it('does not skip custom branch emails for graph-driven automations', () => {
    expect(
      shouldSkipSignupBranchOutboundEmail(
        AutomationPurpose.FUNNEL_SIGNUP,
        { flowBranch: 'path_1_abc', message: 'Custom path' },
        { graphDriven: true },
      ),
    ).toBe(false);
  });
});
