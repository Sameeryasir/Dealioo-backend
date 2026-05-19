import {
  Body,
  Controller,
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
import { StartAutomationExecutionDto } from './automationDto/start-automation-execution.dto';
import { UpdateAutomationDto } from './automationDto/update-automation.dto';
import { UpdateAutomationNodeDto } from './automationDto/update-automation-node.dto';

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

  // --- Connections ---
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

  // --- Executions (runtime) ---
  @UseGuards(AuthGuard('jwt'))
  @Get('execution')
  getExecutions(
    @Query('automationId', new ParseIntPipe({ optional: true }))
    automationId?: number,
    @Query('customerId', new ParseIntPipe({ optional: true }))
    customerId?: number,
    @Query('status') status?: AutomationExecutionStatus,
  ): Promise<AutomationExecution[]> {
    return this.automationService.getExecutions({
      automationId,
      customerId,
      status,
    });
  }

  @UseGuards(AuthGuard('jwt'))
  @Get('execution/:id/logs')
  getExecutionLogs(
    @Param('id', ParseIntPipe) id: number,
  ): Promise<AutomationLog[]> {
    return this.automationService.getExecutionLogs(id);
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
  ): Promise<AutomationExecution> {
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

  // --- Logs ---
  @UseGuards(AuthGuard('jwt'))
  @Get('log')
  getAutomationLogs(
    @Query('automationId', ParseIntPipe) automationId: number,
  ): Promise<AutomationLog[]> {
    return this.automationService.getAutomationLogs(automationId);
  }

  // --- Automations ---
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
    @Query('restaurantId', new ParseIntPipe({ optional: true }))
    restaurantId?: number,
  ): Promise<Automation[]> {
    return this.automationService.getAutomations(restaurantId);
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
