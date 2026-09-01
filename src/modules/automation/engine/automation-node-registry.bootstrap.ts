import { Injectable, OnModuleInit } from '@nestjs/common';
import { AutomationNodeRegistry } from './automation-node-registry.service';
import { TriggerNodeHandler } from '../handlers/trigger-node.handler';

@Injectable()
export class AutomationNodeRegistryBootstrap implements OnModuleInit {
  constructor(
    private readonly registry: AutomationNodeRegistry,
    private readonly triggerNodeHandler: TriggerNodeHandler,
  ) {}

  onModuleInit(): void {
    this.registry.register(this.triggerNodeHandler);
  }
}
