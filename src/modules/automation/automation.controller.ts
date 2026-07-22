import {
  Body,
  Controller,
  DefaultValuePipe,
  Delete,
  Get,
  Param,
  ParseIntPipe,
  Patch,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { SkipThrottle } from '@nestjs/throttler';
import { Automation } from '../../db/entities/automation.entity';
import { AutomationConnection } from '../../db/entities/automation-connection.entity';
import {
  AutomationExecution,
  AutomationExecutionStatus,
} from '../../db/entities/automation-execution.entity';
import { AutomationLog } from '../../db/entities/automation-log.entity';
import { AutomationNode } from '../../db/entities/automation-node.entity';
import { AutomationService } from './automation.service';
import { CreateAutomationConnectionDto } from './automationDto/create-automation-connection.dto';
import { CreateAutomationDto } from './automationDto/create-automation.dto';
import { CreateAutomationNodeDto } from './automationDto/create-automation-node.dto';
import {
  AutomationExecutionStatusDto,
  ExecuteAutomationResponseDto,
  StartAutomationExecutionResponseDto,
} from './automationDto/automation-execution-status.dto';
import { PaginatedExecutionsResponseDto } from './automationDto/paginated-executions.dto';
import { StartAutomationExecutionDto } from './automationDto/start-automation-execution.dto';
import { UpdateAutomationDto } from './automationDto/update-automation.dto';
import { UpdateAutomationNodeDto } from './automationDto/update-automation-node.dto';
import { BootstrapAutomationGraphDto } from './automationDto/bootstrap-automation-graph.dto';

@SkipThrottle()
@Controller('automation')
export class AutomationController {
  constructor(private readonly automationService: AutomationService) {}

  @UseGuards(AuthGuard('jwt'))
  @Post('node')
  createNode(@Body() dto: CreateAutomationNodeDto): Promise<AutomationNode> {
    return this.automationService.createNode(dto);
  }

  @UseGuards(AuthGuard('jwt'))
  @Get('node/funnel/:funnelId')
  getNodesByFunnelId(
    @Param('funnelId', ParseIntPipe) funnelId: number,
  ): Promise<{
    funnelId: number;
    automationIds: number[];
    nodes: AutomationNode[];
    connections: AutomationConnection[];
  }> {
    return this.automationService.getNodesByFunnelId(funnelId);
  }

  @UseGuards(AuthGuard('jwt'))
  @Patch('node/:id')
  updateNode(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpdateAutomationNodeDto,
  ): Promise<AutomationNode> {
    return this.automationService.updateNode(id, dto);
  }

  @UseGuards(AuthGuard('jwt'))
  @Delete('node/:id')
  deleteNode(@Param('id', ParseIntPipe) id: number): Promise<void> {
    return this.automationService.deleteNode(id);
  }

  @UseGuards(AuthGuard('jwt'))
  @Post('connection')
  createConnection(
    @Body() dto: CreateAutomationConnectionDto,
  ): Promise<AutomationConnection> {
    return this.automationService.createConnection(dto);
  }

  @UseGuards(AuthGuard('jwt'))
  @Delete('connection/:id')
  deleteConnection(@Param('id', ParseIntPipe) id: number): Promise<void> {
    return this.automationService.deleteConnection(id);
  }

  @UseGuards(AuthGuard('jwt'))
  @Get('execution')
  getExecutions(
    @Query('automationId', new ParseIntPipe({ optional: true }))
    automationId?: number,
    @Query('customerId', new ParseIntPipe({ optional: true }))
    customerId?: number,
    @Query('status') status?: AutomationExecutionStatus,
    @Query('page', new DefaultValuePipe(1), ParseIntPipe) page?: number,
    @Query('limit', new DefaultValuePipe(10), ParseIntPipe) limit?: number,
  ): Promise<PaginatedExecutionsResponseDto> {
    return this.automationService.getExecutions(
      {
        automationId,
        customerId,
        status,
      },
      page,
      limit,
    );
  }

  @UseGuards(AuthGuard('jwt'))
  @Get('execution/:id/logs')
  getExecutionLogs(
    @Param('id', ParseIntPipe) id: number,
  ): Promise<AutomationLog[]> {
    return this.automationService.getExecutionLogs(id);
  }

  @UseGuards(AuthGuard('jwt'))
  @Get('execution/:id/status')
  getExecutionStatus(
    @Param('id', ParseIntPipe) id: number,
  ): Promise<AutomationExecutionStatusDto> {
    return this.automationService.getExecutionStatus(id);
  }

  @UseGuards(AuthGuard('jwt'))
  @Get('execution/:id')
  getExecutionById(
    @Param('id', ParseIntPipe) id: number,
  ): Promise<AutomationExecution> {
    return this.automationService.getExecutionById(id);
  }

  @UseGuards(AuthGuard('jwt'))
  @Post('execution')
  startExecution(
    @Body() dto: StartAutomationExecutionDto,
    @Req() req,
  ): Promise<StartAutomationExecutionResponseDto> {
    return this.automationService.startExecution(dto, req.user);
  }

  @UseGuards(AuthGuard('jwt'))
  @Post('execution/:id/process')
  processExecution(
    @Param('id', ParseIntPipe) id: number,
    @Req() req,
  ): Promise<void> {
    return this.automationService.processExecution(id, req.user);
  }

  @UseGuards(AuthGuard('jwt'))
  @Post('execution/:id/resume')
  resumeExecution(
    @Param('id', ParseIntPipe) id: number,
    @Req() req,
  ): Promise<void> {
    return this.automationService.resumeExecution(id, req.user);
  }

  @UseGuards(AuthGuard('jwt'))
  @Delete('execution/:id')
  deleteExecution(
    @Param('id', ParseIntPipe) id: number,
    @Req() req,
  ): Promise<void> {
    return this.automationService.deleteExecution(id, req.user);
  }

  @UseGuards(AuthGuard('jwt'))
  @Get('execution/:id/events')
  getExecutionEvents(@Param('id', ParseIntPipe) id: number) {
    return this.automationService.getExecutionEvents(id);
  }

  @UseGuards(AuthGuard('jwt'))
  @Get('execution/:id/steps')
  getExecutionSteps(@Param('id', ParseIntPipe) id: number) {
    return this.automationService.getExecutionSteps(id);
  }

  @UseGuards(AuthGuard('jwt'))
  @Get('execution/:id/recipients')
  getExecutionRecipients(
    @Param('id', ParseIntPipe) id: number,
    @Query('customerId') customerIdRaw?: string,
  ) {
    const customerId =
      customerIdRaw && /^\d+$/.test(customerIdRaw)
        ? Number.parseInt(customerIdRaw, 10)
        : undefined;
    return this.automationService.getExecutionRecipients(id, customerId);
  }

  @UseGuards(AuthGuard('jwt'))
  @Get('execution/:id/summary')
  getExecutionSummary(@Param('id', ParseIntPipe) id: number) {
    return this.automationService.getExecutionSummary(id);
  }

  @UseGuards(AuthGuard('jwt'))
  @Post('execution/recover-stuck')
  recoverStuckExecutions(@Req() req) {
    return this.automationService.recoverStuckExecutions(req.user);
  }

  @UseGuards(AuthGuard('jwt'))
  @Post('execution/:id/recover')
  recoverExecution(
    @Param('id', ParseIntPipe) id: number,
    @Req() req,
  ) {
    return this.automationService.recoverExecution(id, req.user);
  }

  @UseGuards(AuthGuard('jwt'))
  @Get('metrics')
  getAutomationMetrics() {
    return this.automationService.getAutomationMetrics();
  }

  @UseGuards(AuthGuard('jwt'))
  @Get('dead-letter')
  listDeadLetters(
    @Query('limit', new DefaultValuePipe(50), ParseIntPipe) limit?: number,
  ) {
    return this.automationService.listDeadLetters(limit);
  }

  @UseGuards(AuthGuard('jwt'))
  @Post('dead-letter/:id/retry')
  retryDeadLetter(
    @Param('id', ParseIntPipe) id: number,
    @Req() req,
  ) {
    return this.automationService.retryDeadLetter(id, req.user);
  }

  @UseGuards(AuthGuard('jwt'))
  @Post('dead-letter/:id/discard')
  discardDeadLetter(
    @Param('id', ParseIntPipe) id: number,
    @Req() req,
  ): Promise<void> {
    return this.automationService.discardDeadLetter(id, req.user);
  }

  @UseGuards(AuthGuard('jwt'))
  @Get('log')
  getAutomationLogs(
    @Query('automationId', ParseIntPipe) automationId: number,
  ): Promise<AutomationLog[]> {
    return this.automationService.getAutomationLogs(automationId);
  }

  @UseGuards(AuthGuard('jwt'))
  @Post()
  createAutomation(
    @Body() dto: CreateAutomationDto,
    @Req() req,
  ): Promise<Automation> {
    return this.automationService.createAutomation(dto, req.user);
  }

  @UseGuards(AuthGuard('jwt'))
  @Get()
  getAutomations(
    @Query('businessId', new ParseIntPipe({ optional: true }))
    businessId?: number,
  ): Promise<Automation[]> {
    return this.automationService.getAutomations(businessId);
  }

  @UseGuards(AuthGuard('jwt'))
  @Post(':id/bootstrap-graph')
  bootstrapAutomationGraph(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: BootstrapAutomationGraphDto,
    @Req() req,
  ): Promise<Automation> {
    return this.automationService.bootstrapAutomationGraph(id, dto, req.user);
  }

  @UseGuards(AuthGuard('jwt'))
  @Get(':id')
  getAutomationById(
    @Param('id', ParseIntPipe) id: number,
  ): Promise<Automation> {
    return this.automationService.findAutomationById(id);
  }

  @UseGuards(AuthGuard('jwt'))
  @Patch(':id')
  updateAutomation(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpdateAutomationDto,
    @Req() req,
  ): Promise<Automation> {
    return this.automationService.updateAutomation(id, dto, req.user);
  }

  @UseGuards(AuthGuard('jwt'))
  @Delete(':id')
  deleteAutomation(
    @Param('id', ParseIntPipe) id: number,
    @Req() req,
  ): Promise<void> {
    return this.automationService.deleteAutomation(id, req.user);
  }

  @UseGuards(AuthGuard('jwt'))
  @Post(':id/execute')
  executeAutomation(
    @Param('id', ParseIntPipe) id: number,
    @Req() req,
  ): Promise<ExecuteAutomationResponseDto> {
    return this.automationService.executeAutomation(id, req.user);
  }

  @UseGuards(AuthGuard('jwt'))
  @Post(':id/publish')
  publishAutomation(
    @Param('id', ParseIntPipe) id: number,
    @Req() req,
  ): Promise<Automation> {
    return this.automationService.publishAutomation(id, req.user);
  }

  @UseGuards(AuthGuard('jwt'))
  @Post(':id/activate')
  activateAutomation(
    @Param('id', ParseIntPipe) id: number,
    @Req() req,
  ): Promise<Automation> {
    return this.automationService.activateAutomation(id, req.user);
  }

  @UseGuards(AuthGuard('jwt'))
  @Post(':id/deactivate')
  deactivateAutomation(
    @Param('id', ParseIntPipe) id: number,
    @Req() req,
  ): Promise<Automation> {
    return this.automationService.deactivateAutomation(id, req.user);
  }
}
