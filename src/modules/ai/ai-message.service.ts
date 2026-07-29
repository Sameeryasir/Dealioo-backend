import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { AiConversation } from '../../db/entities/ai-conversation.entity';
import { AiMessage } from '../../db/entities/ai-message.entity';
import { AiMessageRole } from '../../db/entities/ai-message-role';
import { CreateAiMessageDto } from './dto/create-ai-message.dto';

@Injectable()
export class AiMessageService {
  constructor(
    @InjectRepository(AiConversation)
    private readonly conversationRepository: Repository<AiConversation>,
    @InjectRepository(AiMessage)
    private readonly messageRepository: Repository<AiMessage>,
  ) {}

  async create(
    conversationId: string,
    dto: CreateAiMessageDto,
  ): Promise<{ message: AiMessage; conversationTitle: string }> {
    const conversation = await this.conversationRepository.findOne({
      where: { id: conversationId },
    });
    if (!conversation) {
      throw new NotFoundException('Conversation not found.');
    }

    const role = dto.role ?? AiMessageRole.USER;
    const message = this.messageRepository.create({
      conversationId,
      role,
      content: dto.content,
      pageId: dto.pageId ?? null,
    });

    await this.messageRepository.save(message);

    conversation.lastMessageAt = new Date();

    if (
      role === AiMessageRole.USER &&
      (!conversation.title || conversation.title === 'New chat')
    ) {
      const cleaned = dto.content.trim().replace(/\s+/g, ' ');
      conversation.title =
        cleaned.length > 60 ? `${cleaned.slice(0, 60)}…` : cleaned || 'New chat';
    }

    await this.conversationRepository.save(conversation);

    return {
      message,
      conversationTitle: conversation.title,
    };
  }

  async findByConversation(
    conversationId: string,
    page: number,
    limit: number,
  ) {
    const conversation = await this.conversationRepository.findOne({
      where: { id: conversationId },
    });
    if (!conversation) {
      throw new NotFoundException('Conversation not found.');
    }

    const [messages, total] = await this.messageRepository.findAndCount({
      where: { conversationId },
      order: { createdAt: 'ASC' },
      skip: (page - 1) * limit,
      take: limit,
    });

    return {
      data: messages,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
        hasNext: page * limit < total,
        hasPrevious: page > 1,
      },
    };
  }

  async findMessages(
    conversationId: string,
    lastMessageId?: string,
    limit = 20,
  ): Promise<{ data: AiMessage[]; hasMore: boolean }> {
    const conversation = await this.conversationRepository.findOne({
      where: { id: conversationId },
    });
    if (!conversation) {
      throw new NotFoundException('Conversation not found.');
    }

    const query = this.messageRepository
      .createQueryBuilder('message')
      .where('message.conversationId = :conversationId', {
        conversationId,
      });

    if (lastMessageId) {
      const lastMessage = await this.messageRepository.findOne({
        where: {
          id: lastMessageId,
          conversationId,
        },
        select: {
          id: true,
          createdAt: true,
        },
      });

      if (!lastMessage) {
        throw new NotFoundException('Message not found.');
      }

      query.andWhere('message.createdAt > :createdAt', {
        createdAt: lastMessage.createdAt,
      });

      const data = await query
        .orderBy('message.createdAt', 'ASC')
        .take(limit)
        .getMany();

      return {
        data,
        hasMore: data.length === limit,
      };
    }

    const latest = await query
      .orderBy('message.createdAt', 'DESC')
      .take(limit)
      .getMany();

    const data = latest.sort(
      (a, b) => a.createdAt.getTime() - b.createdAt.getTime(),
    );

    return {
      data,
      hasMore: data.length === limit,
    };
  }
}
