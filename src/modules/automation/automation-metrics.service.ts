import { Injectable } from '@nestjs/common';
import { AutomationNodeType } from '../../db/entities/automation-node.entity';

type CounterMap = Record<string, number>;

export type AutomationMetricsSnapshot = {
  generatedAt: string;
  nodeExecutions: CounterMap;
  nodeFailures: CounterMap;
  nodeDurationsMs: CounterMap;
  emailSendSuccess: number;
  emailSendFailure: number;
  prepaidLoopRestarts: number;
  executionsCompleted: number;
  executionsFailed: number;
  deadLetterRecorded: number;
  averageNodeDurationMs: Record<string, number>;
};

@Injectable()
export class AutomationMetricsService {
  private nodeExecutions: CounterMap = {};
  private nodeFailures: CounterMap = {};
  private nodeDurationTotals: CounterMap = {};
  private nodeDurationCounts: CounterMap = {};
  private emailSendSuccess = 0;
  private emailSendFailure = 0;
  private prepaidLoopRestarts = 0;
  private executionsCompleted = 0;
  private executionsFailed = 0;
  private deadLetterRecorded = 0;

  recordNodeExecution(
    nodeType: AutomationNodeType | string,
    result: string,
    durationMs: number,
  ): void {
    const key = `${nodeType}:${result}`;
    this.nodeExecutions[key] = (this.nodeExecutions[key] ?? 0) + 1;
    this.nodeDurationTotals[nodeType] =
      (this.nodeDurationTotals[nodeType] ?? 0) + durationMs;
    this.nodeDurationCounts[nodeType] =
      (this.nodeDurationCounts[nodeType] ?? 0) + 1;
  }

  recordNodeFailure(nodeType: AutomationNodeType | string): void {
    this.nodeFailures[nodeType] = (this.nodeFailures[nodeType] ?? 0) + 1;
  }

  recordEmailSend(success: boolean): void {
    if (success) {
      this.emailSendSuccess += 1;
    } else {
      this.emailSendFailure += 1;
    }
  }

  recordPrepaidLoopRestart(): void {
    this.prepaidLoopRestarts += 1;
  }

  recordExecutionCompleted(): void {
    this.executionsCompleted += 1;
  }

  recordExecutionFailed(): void {
    this.executionsFailed += 1;
  }

  recordDeadLetter(): void {
    this.deadLetterRecorded += 1;
  }

  getSnapshot(): AutomationMetricsSnapshot {
    const averageNodeDurationMs: Record<string, number> = {};
    for (const nodeType of Object.keys(this.nodeDurationTotals)) {
      const total = this.nodeDurationTotals[nodeType] ?? 0;
      const count = this.nodeDurationCounts[nodeType] ?? 0;
      averageNodeDurationMs[nodeType] =
        count > 0 ? Math.round(total / count) : 0;
    }

    return {
      generatedAt: new Date().toISOString(),
      nodeExecutions: { ...this.nodeExecutions },
      nodeFailures: { ...this.nodeFailures },
      nodeDurationsMs: { ...this.nodeDurationTotals },
      emailSendSuccess: this.emailSendSuccess,
      emailSendFailure: this.emailSendFailure,
      prepaidLoopRestarts: this.prepaidLoopRestarts,
      executionsCompleted: this.executionsCompleted,
      executionsFailed: this.executionsFailed,
      deadLetterRecorded: this.deadLetterRecorded,
      averageNodeDurationMs,
    };
  }
}
