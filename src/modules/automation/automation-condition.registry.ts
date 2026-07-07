import { Injectable } from '@nestjs/common';
import type {
  AutomationConditionContext,
  AutomationConditionEvaluator,
} from './automation-condition.types';
import { CustomerVisitedConditionEvaluator } from './conditions/customer-visited.condition';

@Injectable()
export class AutomationConditionRegistry {
  private readonly evaluators: AutomationConditionEvaluator[];

  constructor(
    customerVisitedEvaluator: CustomerVisitedConditionEvaluator,
  ) {
    this.evaluators = [customerVisitedEvaluator];
  }

  async evaluate(context: AutomationConditionContext): Promise<boolean | null> {
    const conditionType = context.conditionType.trim();
    if (!conditionType) {
      return null;
    }

    const evaluator = this.evaluators.find((entry) =>
      entry.matches(conditionType),
    );
    if (!evaluator) {
      return null;
    }

    return evaluator.evaluate(context);
  }

  registerEvaluator(evaluator: AutomationConditionEvaluator): void {
    this.evaluators.push(evaluator);
  }
}
