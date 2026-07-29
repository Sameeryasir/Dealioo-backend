import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { AiConversation } from '../../db/entities/ai-conversation.entity';
import { AiConversationStatus } from '../../db/entities/ai-conversation-status';
import { Business } from '../../db/entities/business.entity';
import { Funnel } from '../../db/entities/funnel.entity';
import { User } from '../../db/entities/user.entity';
import { CreateAiConversationDto } from './dto/create-ai-conversation.dto';

@Injectable()
export class AiConversationService {
  constructor(
    @InjectRepository(AiConversation)
    private readonly conversationRepository: Repository<AiConversation>,
    @InjectRepository(Business)
    private readonly businessRepository: Repository<Business>,
    @InjectRepository(Funnel)
    private readonly funnelRepository: Repository<Funnel>,
  ) {}

  async create(
    dto: CreateAiConversationDto,
    user: User,
  ): Promise<AiConversation> {
    const business = await this.businessRepository.findOne({
      where: { id: dto.businessId },
    });
    if (!business) {
      throw new NotFoundException('Business not found.');
    }

    const funnel = await this.funnelRepository.findOne({
      where: {
        id: dto.funnelId,
        businessId: dto.businessId,
      },
    });
    if (!funnel) {
      throw new NotFoundException('Funnel not found.');
    }

    const conversation = this.conversationRepository.create({
      businessId: dto.businessId,
      funnelId: dto.funnelId,
      createdById: user.id,
      title: 'New chat',
      status: AiConversationStatus.ACTIVE,
      lastMessageAt: null,
    });

    return this.conversationRepository.save(conversation);
  }

  async findByFunnelId(funnelId: number): Promise<AiConversation[]> {
    const funnel = await this.funnelRepository.findOne({
      where: { id: funnelId },
    });
    if (!funnel) {
      throw new NotFoundException('Funnel not found.');
    }

    return this.conversationRepository.find({
      where: { funnelId },
      order: {
        lastMessageAt: 'DESC',
        createdAt: 'DESC',
      },
      select: {
        id: true,
        title: true,
        status: true,
        lastMessageAt: true,
        createdAt: true,
        updatedAt: true,
      },
    });
  }

  async remove(conversationId: string): Promise<void> {
    const conversation = await this.conversationRepository.findOne({
      where: { id: conversationId },
    });
    if (!conversation) {
      throw new NotFoundException('Conversation not found.');
    }

    await this.conversationRepository.remove(conversation);
  }
}
