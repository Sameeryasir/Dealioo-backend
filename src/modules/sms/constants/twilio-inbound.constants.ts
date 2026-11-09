export const EMPTY_TWIML_RESPONSE =
  '<?xml version="1.0" encoding="UTF-8"?><Response></Response>';

export const TWILIO_SIGNATURE_HEADER = 'x-twilio-signature';

export const INBOUND_BODY_LOG_MAX_LENGTH = 80;

export {
  SMS_OPT_OUT_CONFIRMATION,
  SMS_OPT_IN_CONFIRMATION,
  buildSmsOptOutTwiml,
} from '../utils/sms-opt-out.util';
