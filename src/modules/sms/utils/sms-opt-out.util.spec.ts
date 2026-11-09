import {
  detectSmsOptOutIntent,
  buildSmsOptOutTwiml,
} from './sms-opt-out.util';

describe('detectSmsOptOutIntent', () => {
  it('detects standard STOP keywords', () => {
    expect(detectSmsOptOutIntent('STOP')).toBe('opt_out');
    expect(detectSmsOptOutIntent(' stopall ')).toBe('opt_out');
    expect(detectSmsOptOutIntent('UNSUBSCRIBE')).toBe('opt_out');
    expect(detectSmsOptOutIntent('Cancel')).toBe('opt_out');
  });

  it('detects plain-language opt-out phrases', () => {
    expect(detectSmsOptOutIntent("I don't want to receive the message")).toBe(
      'opt_out',
    );
    expect(detectSmsOptOutIntent('i dont want to receive messages')).toBe(
      'opt_out',
    );
    expect(detectSmsOptOutIntent('Please do not text me')).toBe('opt_out');
    expect(detectSmsOptOutIntent('no more texts')).toBe('opt_out');
  });

  it('detects START / opt-in keywords', () => {
    expect(detectSmsOptOutIntent('START')).toBe('opt_in');
    expect(detectSmsOptOutIntent('UNSTOP')).toBe('opt_in');
    expect(detectSmsOptOutIntent('yes')).toBe('opt_in');
  });

  it('ignores normal chat', () => {
    expect(detectSmsOptOutIntent('Can I book a table tonight?')).toBeNull();
    expect(detectSmsOptOutIntent('Thanks for the offer')).toBeNull();
  });
});

describe('buildSmsOptOutTwiml', () => {
  it('escapes XML special characters', () => {
    const xml = buildSmsOptOutTwiml(`Stop & "go" <now>`);
    expect(xml).toContain('&amp;');
    expect(xml).toContain('&quot;');
    expect(xml).toContain('&lt;');
    expect(xml).toContain('<Message>');
  });
});
