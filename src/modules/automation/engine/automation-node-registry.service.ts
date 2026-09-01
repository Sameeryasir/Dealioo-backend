import { Injectable, Logger } from '@nestjs/common';
import type { AutomationNodeType } from '../../../db/entities/automation-node.entity';
import type {
  AutomationNodeHandler,
  AutomationNodeHandlerContext,
} from './automation-node-handler.types';
import type { NodeExecutionResult } from './automation-node-result.types';

@Injectable()
export class AutomationNodeRegistry {
  private readonly logger = new Logger(AutomationNodeRegistry.name);
  private readonly handlers = new Map<AutomationNodeType, AutomationNodeHandler>();

  register(handler: AutomationNodeHandler): void {
    this.handlers.set(handler.type, handler);
  }

  has(type: AutomationNodeType): boolean {
    return this.handlers.has(type);
  }

  registeredTypes(): AutomationNodeType[] {
    return [...this.handlers.keys()];
  }

  async execute(
    type: AutomationNodeType,
    context: AutomationNodeHandlerContext,
  ): Promise<NodeExecutionResult | null> {
    const handler = this.handlers.get(type);
    if (!handler) {
      return null;
    }
    return handler.execute(context);
  }

  assertAllTypesRegistered(types: AutomationNodeType[]): string[] {
    const missing: string[] = [];
    for (const type of types) {
      if (!this.handlers.has(type)) {
        missing.push(type);
      }
    }
    return missing;
  }
}
