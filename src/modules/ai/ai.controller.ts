import { Body, Controller, Post, UseGuards } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { AiOrchestratorService } from './ai.orchestrator.service';
import { AiResponseDto } from './dto/ai-response.dto';
import { EditUiDto } from './dto/edit-ui.dto';

@Controller('ai')
export class AiController {
  constructor(private readonly aiOrchestrator: AiOrchestratorService) {}

  @UseGuards(AuthGuard('jwt'))
  @Post('edit-ui')
  async editUi(@Body() dto: EditUiDto): Promise<AiResponseDto> {
    return this.aiOrchestrator.editUi(dto);
  }
}
