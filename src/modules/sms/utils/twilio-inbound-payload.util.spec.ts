import { parseTwilioInboundPayload } from './twilio-inbound-payload.util';

describe('parseTwilioInboundPayload', () => {
  it('parses valid Twilio webhook params', () => {
    const payload = parseTwilioInboundPayload({
      From: '+15551234567',
      To: '+16206999892',
      Body: 'Hello',
      MessageSid: 'SM123',
      SmsStatus: 'received',
    });

    expect(payload).toEqual({
      from: '+15551234567',
      to: '+16206999892',
      body: 'Hello',
      messageSid: 'SM123',
      smsStatus: 'received',
      rawParams: {
        From: '+15551234567',
        To: '+16206999892',
        Body: 'Hello',
        MessageSid: 'SM123',
        SmsStatus: 'received',
      },
    });
  });

  it('returns null when required fields are missing', () => {
    expect(parseTwilioInboundPayload({ From: '+15551234567' })).toBeNull();
  });
});
