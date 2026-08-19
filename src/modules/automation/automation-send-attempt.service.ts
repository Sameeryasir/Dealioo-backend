import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { AutomationSendAttempt } from '../../db/entities/automation-send-attempt.entity';

export const PAYMENT_REMINDER_EMAIL_ACTION = 'payment_reminder_email';
export const PAYMENT_REMINDER_PASS_ACTION = 'payment_reminder_pass';

@Injectable()
export class AutomationSendAttemptService {
  constructor(
    @InjectRepository(AutomationSendAttempt)
    private readonly sendAttemptRepository: Repository<AutomationSendAttempt>,
  ) {}

  async tryClaim(input: {
    automationId: number;
    customerId: number;
    actionType: string;
    attempt: number;
    executionId: number;
  }): Promise<boolean> {
    const rows: Array<{ id: number }> = await this.sendAttemptRepository.query(
      `
        INSERT INTO automation_send_attempt
          (automation_id, customer_id, action_type, attempt, execution_id)
        VALUES ($1, $2, $3, $4, $5)
        ON CONFLICT (automation_id, customer_id, action_type, attempt)
        DO NOTHING
        RETURNING id
      `,
      [
        input.automationId,
        input.customerId,
        input.actionType,
        input.attempt,
        input.executionId,
      ],
    );
    return rows.length > 0;
  }
}
