import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, In, Not, Repository } from 'typeorm';
import { AuthService } from '../auth/auth.service';
import {
  buildPaginationMeta,
  normalizePagination,
  type PaginationMeta,
} from '../../common/pagination';
import { Business } from '../../db/entities/business.entity';
import { BusinessMember } from '../../db/entities/business-member.entity';
import { CustomerOnboarding } from '../../db/entities/customer-onboarding.entity';
import { MeetingRequest } from '../../db/entities/meeting-request.entity';
import { OnboardingTask } from '../../db/entities/onboarding-task.entity';
import { PlatformAdminAuditLog } from '../../db/entities/platform-admin-audit-log.entity';
import { Role } from '../../db/entities/role.entity';
import { User } from '../../db/entities/user.entity';
import {
  isValidBusinessSlug,
  slugifyBusinessName,
} from '../../utils/business-slug';
import { ADMIN_ROLE, isSuperAdmin } from '../../utils/user-roles';
import { BUSINESS_MEMBER_STATUS } from '../member/business-member-status';
import { ALL_BUSINESS_MEMBER_PERMISSIONS } from '../member/member.constants';
import {
  CUSTOMER_ONBOARDING_STATUS,
  MEETING_ATTENDANCE,
  MEETING_SALES_OUTCOME,
  ONBOARDING_TASK_KEYS,
  ONBOARDING_TASK_LABELS,
  ONBOARDING_TASK_STATUS,
  type CustomerOnboardingStatus,
  type OnboardingTaskKey,
} from './customer-onboarding.constants';
import { CreateAccountFromMeetingDto } from './dto/create-account-from-meeting.dto';
import { CreateOnboardingBusinessDto } from './dto/create-onboarding-business.dto';
import { UpdateCustomerOnboardingDto } from './dto/update-customer-onboarding.dto';
import { UpdateMeetingOutcomeDto } from './dto/update-meeting-outcome.dto';
import { UpdateOnboardingTaskDto } from './dto/update-onboarding-task.dto';

export type CustomerOnboardingListItem = {
  id: number;
  meetingId: number;
  status: CustomerOnboardingStatus;
  customerName: string;
  customerEmail: string;
  businessName: string;
  businessCategory: string | null;
  selectedPlanId: number | null;
  assignedAdminId: number | null;
  assignedAdminName: string | null;
  meetingDate: string | null;
  meetingTime: string | null;
  progressCompleted: number;
  progressTotal: number;
  progressPercent: number;
  userId: number | null;
  businessId: number | null;
  updatedAt: Date;
  createdAt: Date;
};

@Injectable()
export class CustomerOnboardingService {
  private readonly logger = new Logger(CustomerOnboardingService.name);

  constructor(
    private readonly dataSource: DataSource,
    private readonly authService: AuthService,
    @InjectRepository(MeetingRequest)
    private readonly meetingRequestRepository: Repository<MeetingRequest>,
    @InjectRepository(CustomerOnboarding)
    private readonly onboardingRepository: Repository<CustomerOnboarding>,
    @InjectRepository(OnboardingTask)
    private readonly taskRepository: Repository<OnboardingTask>,
    @InjectRepository(User)
    private readonly userRepository: Repository<User>,
    @InjectRepository(Role)
    private readonly roleRepository: Repository<Role>,
    @InjectRepository(Business)
    private readonly businessRepository: Repository<Business>,
    @InjectRepository(BusinessMember)
    private readonly businessMemberRepository: Repository<BusinessMember>,
    @InjectRepository(PlatformAdminAuditLog)
    private readonly auditLogRepository: Repository<PlatformAdminAuditLog>,
  ) {}

  private assertSuperAdmin(actor: User): void {
    if (!isSuperAdmin(actor)) {
      throw new ForbiddenException('Super Admin access required.');
    }
  }

  private async writeAudit(input: {
    actorUserId: number;
    action: string;
    targetType: string;
    targetId?: string | number | null;
    metadata?: Record<string, unknown> | null;
  }): Promise<void> {
    try {
      await this.auditLogRepository.save(
        this.auditLogRepository.create({
          actorUserId: input.actorUserId,
          action: input.action,
          targetType: input.targetType,
          targetId:
            input.targetId == null ? null : String(input.targetId),
          metadata: input.metadata ?? null,
        }),
      );
    } catch {
      return;
    }
  }

  private mapMeeting(row: MeetingRequest) {
    return {
      id: row.id,
      firstName: row.firstName,
      lastName: row.lastName,
      email: row.email,
      phone: row.phone,
      businessName: row.businessName,
      businessRole: row.businessRole,
      businessCategory: row.businessCategory,
      cityLocation: row.cityLocation,
      monthlyRevenue: row.monthlyRevenue,
      marketingActivities: Array.isArray(row.marketingActivities)
        ? row.marketingActivities
        : [],
      currentSituation: row.currentSituation,
      startTimeline: row.startTimeline,
      meetingCommitment: row.meetingCommitment,
      scheduledDate: row.scheduledDate,
      scheduledTime: row.scheduledTime,
      scheduledDuration: row.scheduledDuration,
      scheduledTimeZone: row.scheduledTimeZone,
      businessPhone: row.businessPhone,
      businessEmail: row.businessEmail,
      website: row.website,
      description: row.description,
      state: row.state,
      postalCode: row.postalCode,
      country: row.country,
      currency: row.currency,
      googleEventLink: row.googleEventLink,
      googleMeetLink: row.googleMeetLink,
      attendance: row.attendance,
      salesOutcome: row.salesOutcome,
      meetingNotes: row.meetingNotes,
      followUpNotes: row.followUpNotes,
      outcomeUpdatedAt: row.outcomeUpdatedAt,
      outcomeUpdatedBy: row.outcomeUpdatedBy,
      createdAt: row.createdAt,
    };
  }

  async listMeetingRequests(
    actor: User,
    scope: 'upcoming' | 'past' | 'all' = 'all',
  ): Promise<{
    total: number;
    items: ReturnType<CustomerOnboardingService['mapMeeting']>[];
  }> {
    this.assertSuperAdmin(actor);

    const rows = await this.meetingRequestRepository.find({
      order: { createdAt: 'DESC' },
      take: 500,
    });

    const onboardingRows = await this.onboardingRepository.find({
      where: {
        meetingId: In(rows.map((row) => row.id)),
        status: Not(CUSTOMER_ONBOARDING_STATUS.CANCELLED),
      },
      select: ['id', 'meetingId', 'status', 'businessId', 'userId'],
    });
    const onboardingByMeeting = new Map(
      onboardingRows.map((row) => [row.meetingId, row]),
    );

    const filtered = rows.filter((row) => {
      if (scope === 'all') return true;
      const upcoming = isFutureMeeting(row);
      return scope === 'upcoming' ? upcoming : !upcoming;
    });

    return {
      total: filtered.length,
      items: filtered.map((row) => {
        const onboarding = onboardingByMeeting.get(row.id);
        return {
          ...this.mapMeeting(row),
          onboardingId: onboarding?.id ?? null,
          onboardingStatus: onboarding?.status ?? null,
          businessId: onboarding?.businessId ?? null,
          userId: onboarding?.userId ?? null,
        };
      }),
    };
  }

  async updateMeetingOutcome(
    actor: User,
    meetingId: number,
    dto: UpdateMeetingOutcomeDto,
  ) {
    this.assertSuperAdmin(actor);

    const meeting = await this.meetingRequestRepository.findOne({
      where: { id: meetingId },
    });
    if (!meeting) {
      throw new NotFoundException('Meeting request not found.');
    }

    if (dto.attendance !== undefined) {
      if (
        meeting.attendance &&
        dto.attendance !== meeting.attendance
      ) {
        throw new BadRequestException(
          'Attendance cannot be changed after it was recorded.',
        );
      }
      if (!meeting.attendance) {
        meeting.attendance = dto.attendance;
      }
    }
    if (dto.salesOutcome !== undefined) {
      if (
        dto.salesOutcome != null &&
        meeting.attendance !== MEETING_ATTENDANCE.ATTENDED &&
        dto.attendance !== MEETING_ATTENDANCE.ATTENDED
      ) {
        throw new BadRequestException(
          'Sales outcome can only be set when attendance is ATTENDED.',
        );
      }

      if (
        meeting.salesOutcome === MEETING_SALES_OUTCOME.DEAL_WON &&
        dto.salesOutcome !== MEETING_SALES_OUTCOME.DEAL_WON
      ) {
        const existingOnboarding = await this.onboardingRepository.findOne({
          where: {
            meetingId,
            status: Not(CUSTOMER_ONBOARDING_STATUS.CANCELLED),
          },
          select: ['id', 'businessId', 'status'],
        });
        if (existingOnboarding?.businessId) {
          const activeBusiness = await this.businessRepository.findOne({
            where: { id: existingOnboarding.businessId },
            select: ['id'],
          });
          if (activeBusiness) {
            throw new BadRequestException(
              'Cannot undo Deal won after the customer account was created. Open the business instead.',
            );
          }
        }
        if (
          existingOnboarding &&
          existingOnboarding.status !== CUSTOMER_ONBOARDING_STATUS.CANCELLED
        ) {
          await this.onboardingRepository.update(
            { id: existingOnboarding.id },
            { status: CUSTOMER_ONBOARDING_STATUS.CANCELLED },
          );
        }
      }

      meeting.salesOutcome = dto.salesOutcome;
    }
    if (dto.meetingNotes !== undefined) {
      meeting.meetingNotes = dto.meetingNotes?.trim() || null;
    }
    if (dto.followUpNotes !== undefined) {
      meeting.followUpNotes = dto.followUpNotes?.trim() || null;
    }

    if (
      meeting.attendance &&
      meeting.attendance !== MEETING_ATTENDANCE.ATTENDED
    ) {
      meeting.salesOutcome = null;
    }

    meeting.outcomeUpdatedAt = new Date();
    meeting.outcomeUpdatedBy = actor.id;

    const saved = await this.meetingRequestRepository.save(meeting);
    await this.writeAudit({
      actorUserId: actor.id,
      action: 'meeting_outcome_updated',
      targetType: 'meeting_request',
      targetId: saved.id,
      metadata: {
        attendance: saved.attendance,
        salesOutcome: saved.salesOutcome,
      },
    });

    const onboarding = await this.onboardingRepository.findOne({
      where: {
        meetingId: saved.id,
        status: Not(CUSTOMER_ONBOARDING_STATUS.CANCELLED),
      },
      select: ['id', 'status', 'businessId', 'userId'],
    });

    return {
      ...this.mapMeeting(saved),
      onboardingId: onboarding?.id ?? null,
      onboardingStatus: onboarding?.status ?? null,
      businessId: onboarding?.businessId ?? null,
      userId: onboarding?.userId ?? null,
    };
  }

  async startOnboardingFromMeeting(
    actor: User,
    meetingId: number,
    dto: CreateAccountFromMeetingDto = {},
  ) {
    this.assertSuperAdmin(actor);

    const meeting = await this.meetingRequestRepository.findOne({
      where: { id: meetingId },
    });
    if (!meeting) {
      throw new NotFoundException('Meeting request not found.');
    }

    if (meeting.attendance !== MEETING_ATTENDANCE.ATTENDED) {
      throw new BadRequestException(
        'Meeting must be marked ATTENDED before creating the account.',
      );
    }
    if (meeting.salesOutcome !== MEETING_SALES_OUTCOME.DEAL_WON) {
      throw new BadRequestException(
        'Sales outcome must be DEAL_WON before creating the account.',
      );
    }

    const existingReady = await this.onboardingRepository.findOne({
      where: {
        meetingId,
        status: Not(CUSTOMER_ONBOARDING_STATUS.CANCELLED),
      },
      select: ['id', 'userId', 'businessId'],
    });
    if (existingReady?.businessId) {
      const activeBusiness = await this.businessRepository.findOne({
        where: { id: existingReady.businessId },
        select: ['id'],
      });
      if (activeBusiness && existingReady.userId) {
        throw new ConflictException(
          'An account was already created for this meeting.',
        );
      }
    }

    const customerName = (
      dto.customerName?.trim() ||
      `${meeting.firstName} ${meeting.lastName}`.trim() ||
      meeting.email
    ).trim();
    const email = (
      dto.customerEmail?.trim() || meeting.email
    ).trim().toLowerCase();
    const customerPhone = (
      dto.customerPhone?.trim() ||
      meeting.phone?.trim() ||
      ''
    ).trim();
    const businessName = (
      dto.businessName?.trim() ||
      meeting.businessName?.trim() ||
      customerName
    ).trim();
    const businessType = (
      dto.businessType?.trim() ||
      meeting.businessCategory?.trim() ||
      'Business'
    ).trim();
    const phoneNumber = (
      dto.phoneNumber?.trim() ||
      meeting.businessPhone?.trim() ||
      customerPhone
    ).trim();
    const businessEmail = (
      dto.businessEmail?.trim() ||
      meeting.businessEmail?.trim() ||
      email
    )
      .trim()
      .toLowerCase();
    const currency = (
      dto.currency?.trim() ||
      meeting.currency?.trim() ||
      'USD'
    ).toUpperCase();

    if (!email) {
      throw new BadRequestException('Customer email is required.');
    }
    if (!phoneNumber) {
      throw new BadRequestException(
        'A phone number is required to create the business.',
      );
    }

    const existingUser = await this.userRepository.findOne({
      where: { email },
    });
    if (existingUser && !dto.existingUserAction) {
      const ownedBusinesses = await this.businessRepository.find({
        where: { owner: { id: existingUser.id } },
        select: ['id', 'name', 'slug'],
        take: 20,
      });
      throw new ConflictException({
        statusCode: 409,
        error: 'EXISTING_USER',
        message: 'A user with this email already exists.',
        existingUser: {
          id: existingUser.id,
          name: existingUser.name,
          email: existingUser.email,
        },
        businesses: ownedBusinesses.map((business) => ({
          id: business.id,
          name: business.name,
          slug: business.slug,
        })),
      });
    }

    const nameParts = customerName.split(/\s+/).filter(Boolean);
    meeting.firstName = nameParts[0] || meeting.firstName;
    meeting.lastName = nameParts.slice(1).join(' ') || meeting.lastName;
    meeting.email = email;
    meeting.phone = customerPhone || meeting.phone;
    meeting.businessName = businessName;
    meeting.businessCategory = businessType;
    meeting.businessPhone = phoneNumber;
    meeting.businessEmail = businessEmail;
    meeting.website = dto.websiteUrl?.trim() || meeting.website;
    meeting.cityLocation = dto.city?.trim() || meeting.cityLocation;
    meeting.state = dto.state?.trim() || meeting.state;
    meeting.country = dto.country?.trim() || meeting.country;
    meeting.postalCode = dto.postalCode?.trim() || meeting.postalCode;
    meeting.currency = currency;
    await this.meetingRequestRepository.save(meeting);

    let createdNewUser = false;
    let shouldSendPasswordSetup = false;

    try {
      const saved = await this.dataSource.transaction(async (manager) => {
        const onboardingRepo = manager.getRepository(CustomerOnboarding);
        const userRepo = manager.getRepository(User);
        const roleRepo = manager.getRepository(Role);
        const businessRepo = manager.getRepository(Business);
        const memberRepo = manager.getRepository(BusinessMember);

        let onboarding = await onboardingRepo.findOne({
          where: {
            meetingId,
            status: Not(CUSTOMER_ONBOARDING_STATUS.CANCELLED),
          },
        });

        if (onboarding?.businessId) {
          const activeBusiness = await businessRepo.findOne({
            where: { id: onboarding.businessId },
            select: ['id'],
          });
          if (activeBusiness && onboarding.userId) {
            throw new ConflictException(
              'An account was already created for this meeting. Refresh and try again.',
            );
          }
          if (!activeBusiness) {
            onboarding.businessId = null;
          }
        }

        if (!onboarding) {
          onboarding = await onboardingRepo.save(
            onboardingRepo.create({
              meetingId: meeting.id,
              assignedAdminId: actor.id,
              status: CUSTOMER_ONBOARDING_STATUS.IN_PROGRESS,
              customerName,
              customerEmail: email,
              customerPhone: customerPhone || null,
              businessName,
              businessCategory: businessType,
              draftPayload: {
                fromMeeting: {
                  businessPhone: phoneNumber,
                  businessEmail,
                  website: meeting.website,
                  description: meeting.description,
                  cityLocation: meeting.cityLocation,
                  state: meeting.state,
                  postalCode: meeting.postalCode,
                  country: meeting.country,
                  currency,
                },
              },
              startedAt: new Date(),
            }),
          );
        } else {
          onboarding.customerName = customerName;
          onboarding.customerEmail = email;
          onboarding.customerPhone = customerPhone || null;
          onboarding.businessName = businessName;
          onboarding.businessCategory = businessType;
          onboarding.assignedAdminId = onboarding.assignedAdminId ?? actor.id;
        }

        let user: User | null =
          onboarding.userId != null
            ? await userRepo.findOne({ where: { id: onboarding.userId } })
            : null;

        if (!user && existingUser) {
          user = existingUser;
        }

        if (!user) {
          const role = await roleRepo.findOne({ where: { name: ADMIN_ROLE } });
          if (!role) {
            throw new NotFoundException(`Role '${ADMIN_ROLE}' does not exist.`);
          }
          user = await userRepo.save(
            userRepo.create({
              name: customerName,
              email,
              phone: customerPhone || null,
              passwordHash: null,
              role,
              createdBy: actor,
              isActive: true,
              emailVerified: false,
              provider: 'LOCAL',
            }),
          );
          createdNewUser = true;
          shouldSendPasswordSetup = true;
        } else {
          const withPassword = await userRepo
            .createQueryBuilder('user')
            .addSelect('user.passwordHash')
            .where('user.id = :id', { id: user.id })
            .getOne();
          if (!withPassword?.passwordHash) {
            shouldSendPasswordSetup = true;
          }
        }

        onboarding.userId = user.id;

        if (
          dto.existingUserAction === 'link_existing_business' &&
          dto.linkBusinessId
        ) {
          const linkBusiness = await businessRepo.findOne({
            where: { id: dto.linkBusinessId },
            relations: ['owner'],
          });
          if (!linkBusiness) {
            throw new NotFoundException('Business to link was not found.');
          }
          if (linkBusiness.owner?.id && linkBusiness.owner.id !== user.id) {
            throw new ConflictException(
              'That business already belongs to a different owner.',
            );
          }
          if (!linkBusiness.owner) {
            linkBusiness.owner = user;
            await businessRepo.save(linkBusiness);
          }
          const member = await memberRepo.findOne({
            where: {
              business: { id: linkBusiness.id },
              user: { id: user.id },
            },
          });
          if (!member) {
            const ownerRole = await roleRepo.findOne({
              where: { name: ADMIN_ROLE },
            });
            await memberRepo.save(
              memberRepo.create({
                business: linkBusiness,
                user,
                role: 'Owner',
                memberRole: ownerRole,
                status: BUSINESS_MEMBER_STATUS.ACTIVE,
                invitedBy: null,
                joinedAt: new Date(),
                permissions: [...ALL_BUSINESS_MEMBER_PERMISSIONS],
              }),
            );
          }
          onboarding.businessId = linkBusiness.id;
          onboarding.businessName = linkBusiness.name;
        } else if (!onboarding.businessId) {
          const slug = await this.resolveUniqueBusinessSlug(businessName);
          const createdAt = new Date();
          const business = await businessRepo.save(
            businessRepo.create({
              name: businessName,
              slug,
              description: meeting.description?.trim() || null,
              logoUrl: null,
              businessType,
              currency,
              websiteUrl:
                dto.websiteUrl?.trim() || meeting.website?.trim() || null,
              email: businessEmail,
              phoneNumber,
              city: dto.city?.trim() || meeting.cityLocation?.trim() || null,
              state: dto.state?.trim() || meeting.state?.trim() || null,
              country: dto.country?.trim() || meeting.country?.trim() || null,
              postalCode:
                dto.postalCode?.trim() || meeting.postalCode?.trim() || null,
              branchCount: 0,
              owner: user,
              onboardingCompleted: true,
              onboardingCompletedAt: createdAt,
            }),
          );

          const ownerRole = await roleRepo.findOne({
            where: { name: ADMIN_ROLE },
          });
          await memberRepo.save(
            memberRepo.create({
              business,
              user,
              role: 'Owner',
              memberRole: ownerRole,
              status: BUSINESS_MEMBER_STATUS.ACTIVE,
              invitedBy: null,
              joinedAt: createdAt,
              permissions: [...ALL_BUSINESS_MEMBER_PERMISSIONS],
            }),
          );

          onboarding.businessId = business.id;
          onboarding.businessName = business.name;
        }

        onboarding.status = CUSTOMER_ONBOARDING_STATUS.ACTIVATED;
        onboarding.completedAt = new Date();
        await onboardingRepo.save(onboarding);

        return onboardingRepo.findOneOrFail({
          where: { id: onboarding.id },
          relations: ['tasks', 'assignedAdmin', 'meeting', 'user', 'business'],
        });
      });

      await this.writeAudit({
        actorUserId: actor.id,
        action: 'customer_account_created_from_meeting',
        targetType: 'customer_onboarding',
        targetId: saved.id,
        metadata: {
          meetingId,
          userId: saved.userId,
          businessId: saved.businessId,
          createdNewUser,
          existingUserAction: dto.existingUserAction ?? null,
          passwordSetupEmailQueued: shouldSendPasswordSetup,
        },
      });

      let passwordSetupEmailSent = false;
      let setPasswordUrl: string | null = null;
      if (shouldSendPasswordSetup && saved.user) {
        try {
          const setup = await this.authService.sendSetPasswordSetupEmail(
            saved.user,
            { businessName: saved.businessName },
          );
          passwordSetupEmailSent = true;
          setPasswordUrl = setup.setPasswordUrl;
        } catch (error) {
          this.logger.error(
            `Failed to send set-password email for user ${saved.user.id}`,
            error instanceof Error ? error.stack : undefined,
          );
        }
      }

      return {
        ...this.toOnboardingDetail(saved),
        createdNewUser,
        passwordSetupEmailSent,
        setPasswordUrl,
      };
    } catch (error) {
      if (
        error instanceof BadRequestException ||
        error instanceof NotFoundException ||
        error instanceof ConflictException
      ) {
        throw error;
      }
      if (isUniqueViolation(error)) {
        throw new ConflictException(
          'An account was already created for this meeting. Refresh and try again.',
        );
      }
      throw error;
    }
  }

  async listOnboardings(
    actor: User,
    page?: number,
    limit?: number,
    search?: string,
    status?: string,
    sort: 'newest' | 'oldest' | 'updated' = 'updated',
  ): Promise<{
    items: CustomerOnboardingListItem[];
    meta: PaginationMeta;
    counts: Record<string, number>;
  }> {
    this.assertSuperAdmin(actor);
    const pagination = normalizePagination(page, limit);

    const qb = this.onboardingRepository
      .createQueryBuilder('o')
      .leftJoinAndSelect('o.assignedAdmin', 'admin')
      .leftJoinAndSelect('o.meeting', 'meeting')
      .leftJoinAndSelect('o.tasks', 'tasks');

    if (status && status !== 'all') {
      const normalized = status.trim().toUpperCase();
      if (
        !Object.values(CUSTOMER_ONBOARDING_STATUS).includes(
          normalized as CustomerOnboardingStatus,
        )
      ) {
        throw new BadRequestException('Invalid onboarding status filter.');
      }
      qb.andWhere('o.status = :status', { status: normalized });
    }

    const term = search?.trim();
    if (term) {
      qb.andWhere(
        `(o.customer_name ILIKE :term
          OR o.customer_email ILIKE :term
          OR o.business_name ILIKE :term)`,
        { term: `%${term}%` },
      );
    }

    if (sort === 'oldest') {
      qb.orderBy('o.createdAt', 'ASC');
    } else if (sort === 'newest') {
      qb.orderBy('o.createdAt', 'DESC');
    } else {
      qb.orderBy('o.updatedAt', 'DESC');
    }

    const [rows, total] = await qb
      .skip(pagination.skip)
      .take(pagination.limit)
      .getManyAndCount();

    const countRows = await this.onboardingRepository
      .createQueryBuilder('o')
      .select('o.status', 'status')
      .addSelect('COUNT(*)', 'count')
      .groupBy('o.status')
      .getRawMany<{ status: string; count: string }>();

    const counts: Record<string, number> = {
      all: 0,
      NOT_STARTED: 0,
      IN_PROGRESS: 0,
      READY_FOR_REVIEW: 0,
      APPROVED: 0,
      INVITATION_SENT: 0,
      ACTIVATED: 0,
      ON_HOLD: 0,
      CANCELLED: 0,
    };
    for (const row of countRows) {
      const value = Number(row.count) || 0;
      counts[row.status] = value;
      counts.all += value;
    }

    return {
      items: rows.map((row) => this.toListItem(row)),
      meta: buildPaginationMeta(total, pagination.page, pagination.limit),
      counts,
    };
  }

  async getOnboarding(actor: User, onboardingId: number) {
    this.assertSuperAdmin(actor);
    const row = await this.onboardingRepository.findOne({
      where: { id: onboardingId },
      relations: ['tasks', 'assignedAdmin', 'meeting', 'user', 'business'],
    });
    if (!row) {
      throw new NotFoundException('Customer onboarding not found.');
    }
    return this.toOnboardingDetail(row);
  }

  async updateOnboarding(
    actor: User,
    onboardingId: number,
    dto: UpdateCustomerOnboardingDto,
  ) {
    this.assertSuperAdmin(actor);
    const row = await this.onboardingRepository.findOne({
      where: { id: onboardingId },
      relations: ['tasks', 'assignedAdmin', 'meeting'],
    });
    if (!row) {
      throw new NotFoundException('Customer onboarding not found.');
    }

    if (dto.status !== undefined) {
      if (row.status === CUSTOMER_ONBOARDING_STATUS.ACTIVATED) {
        throw new BadRequestException(
          'Activated onboarding cannot change status.',
        );
      }
      row.status = dto.status;
    }
    if (dto.internalNotes !== undefined) {
      row.internalNotes = dto.internalNotes?.trim() || null;
    }
    if (dto.draftPayload !== undefined) {
      row.draftPayload = dto.draftPayload;
    }

    const saved = await this.onboardingRepository.save(row);
    await this.writeAudit({
      actorUserId: actor.id,
      action: 'customer_onboarding_updated',
      targetType: 'customer_onboarding',
      targetId: saved.id,
      metadata: { status: saved.status },
    });

    const fresh = await this.onboardingRepository.findOneOrFail({
      where: { id: saved.id },
      relations: ['tasks', 'assignedAdmin', 'meeting'],
    });
    return this.toOnboardingDetail(fresh);
  }

  async prepareAccount(actor: User, onboardingId: number) {
    this.assertSuperAdmin(actor);
    const onboarding = await this.onboardingRepository.findOne({
      where: { id: onboardingId },
      relations: ['tasks', 'assignedAdmin', 'meeting', 'user', 'business'],
    });
    if (!onboarding) {
      throw new NotFoundException('Customer onboarding not found.');
    }
    if (onboarding.status === CUSTOMER_ONBOARDING_STATUS.CANCELLED) {
      throw new BadRequestException('Cancelled onboarding cannot be updated.');
    }

    const email = onboarding.customerEmail.trim().toLowerCase();
    let user = await this.userRepository.findOne({
      where: { email },
      relations: ['role'],
    });
    let created = false;

    if (!user) {
      const role = await this.roleRepository.findOne({
        where: { name: ADMIN_ROLE },
      });
      if (!role) {
        throw new NotFoundException(`Role '${ADMIN_ROLE}' does not exist.`);
      }
      user = await this.userRepository.save(
        this.userRepository.create({
          name: onboarding.customerName.trim() || email,
          email,
          phone: onboarding.customerPhone,
          passwordHash: null,
          role,
          createdBy: actor,
          isActive: true,
          emailVerified: false,
          provider: 'LOCAL',
        }),
      );
      created = true;
    }

    onboarding.userId = user.id;
    await this.onboardingRepository.save(onboarding);
    await this.markTaskCompleted(
      onboarding.id,
      'customer_information',
      actor.id,
    );

    await this.writeAudit({
      actorUserId: actor.id,
      action: created
        ? 'customer_onboarding_account_created'
        : 'customer_onboarding_account_linked',
      targetType: 'customer_onboarding',
      targetId: onboarding.id,
      metadata: { userId: user.id, email, created },
    });

    return this.getOnboarding(actor, onboardingId);
  }

  async createOrLinkBusiness(
    actor: User,
    onboardingId: number,
    dto: CreateOnboardingBusinessDto,
  ) {
    this.assertSuperAdmin(actor);
    const onboarding = await this.onboardingRepository.findOne({
      where: { id: onboardingId },
      relations: ['tasks', 'assignedAdmin', 'meeting', 'user', 'business'],
    });
    if (!onboarding) {
      throw new NotFoundException('Customer onboarding not found.');
    }
    if (onboarding.status === CUSTOMER_ONBOARDING_STATUS.CANCELLED) {
      throw new BadRequestException('Cancelled onboarding cannot be updated.');
    }
    if (!onboarding.userId) {
      throw new BadRequestException(
        'Prepare the customer account before creating or linking a business.',
      );
    }
    if (onboarding.businessId) {
      throw new ConflictException(
        'This onboarding already has a linked business.',
      );
    }

    const owner = await this.userRepository.findOne({
      where: { id: onboarding.userId },
    });
    if (!owner) {
      throw new NotFoundException('Linked customer account was not found.');
    }

    const draft = (onboarding.draftPayload?.fromMeeting ?? {}) as Record<
      string,
      unknown
    >;

    let business: Business;

    if (dto.linkBusinessId) {
      const existing = await this.businessRepository.findOne({
        where: { id: dto.linkBusinessId },
        relations: ['owner'],
      });
      if (!existing) {
        throw new NotFoundException('Business to link was not found.');
      }
      if (existing.owner?.id && existing.owner.id !== owner.id) {
        throw new ConflictException(
          'That business already belongs to a different owner.',
        );
      }
      if (!existing.owner) {
        existing.owner = owner;
        await this.businessRepository.save(existing);
      }
      const member = await this.businessMemberRepository.findOne({
        where: {
          business: { id: existing.id },
          user: { id: owner.id },
        },
      });
      if (!member) {
        const ownerRole = await this.roleRepository.findOne({
          where: { name: ADMIN_ROLE },
        });
        await this.businessMemberRepository.save(
          this.businessMemberRepository.create({
            business: existing,
            user: owner,
            role: 'Owner',
            memberRole: ownerRole,
            status: BUSINESS_MEMBER_STATUS.ACTIVE,
            invitedBy: null,
            joinedAt: new Date(),
            permissions: [...ALL_BUSINESS_MEMBER_PERMISSIONS],
          }),
        );
      }
      business = existing;
    } else {
      const name = (dto.name?.trim() || onboarding.businessName).trim();
      if (!name) {
        throw new BadRequestException('Business name is required.');
      }
      const phoneNumber =
        dto.phoneNumber?.trim() ||
        onboarding.customerPhone?.trim() ||
        String(draft.businessPhone ?? '').trim();
      if (!phoneNumber) {
        throw new BadRequestException('Phone number is required.');
      }
      const businessType =
        dto.businessType?.trim() ||
        onboarding.businessCategory?.trim() ||
        '';
      if (!businessType) {
        throw new BadRequestException('Business type is required.');
      }
      const currency = (
        dto.currency?.trim() ||
        String(draft.currency ?? 'USD')
      ).toUpperCase();
      if (!currency) {
        throw new BadRequestException('Currency is required.');
      }

      const slug = await this.resolveUniqueBusinessSlug(name);
      const createdAt = new Date();
      business = await this.businessRepository.save(
        this.businessRepository.create({
          name,
          slug,
          description:
            dto.description?.trim() ||
            String(draft.description ?? '').trim() ||
            null,
          logoUrl: null,
          businessType,
          currency,
          websiteUrl:
            dto.websiteUrl?.trim() ||
            String(draft.website ?? '').trim() ||
            null,
          email:
            dto.email?.trim() ||
            String(draft.businessEmail ?? '').trim() ||
            onboarding.customerEmail,
          phoneNumber,
          city:
            dto.city?.trim() ||
            String(draft.cityLocation ?? '').trim() ||
            null,
          state: dto.state?.trim() || String(draft.state ?? '').trim() || null,
          country:
            dto.country?.trim() || String(draft.country ?? '').trim() || null,
          postalCode:
            dto.postalCode?.trim() ||
            String(draft.postalCode ?? '').trim() ||
            null,
          branchCount: 0,
          owner,
          onboardingCompleted: true,
          onboardingCompletedAt: createdAt,
        }),
      );

      const ownerRole = await this.roleRepository.findOne({
        where: { name: ADMIN_ROLE },
      });
      await this.businessMemberRepository.save(
        this.businessMemberRepository.create({
          business,
          user: owner,
          role: 'Owner',
          memberRole: ownerRole,
          status: BUSINESS_MEMBER_STATUS.ACTIVE,
          invitedBy: null,
          joinedAt: createdAt,
          permissions: [...ALL_BUSINESS_MEMBER_PERMISSIONS],
        }),
      );
    }

    onboarding.businessId = business.id;
    onboarding.businessName = business.name;
    await this.onboardingRepository.save(onboarding);
    await this.markTaskCompleted(
      onboarding.id,
      'business_information',
      actor.id,
    );

    await this.writeAudit({
      actorUserId: actor.id,
      action: dto.linkBusinessId
        ? 'customer_onboarding_business_linked'
        : 'customer_onboarding_business_created',
      targetType: 'customer_onboarding',
      targetId: onboarding.id,
      metadata: { businessId: business.id },
    });

    return this.getOnboarding(actor, onboardingId);
  }

  async updateTask(
    actor: User,
    onboardingId: number,
    taskId: number,
    dto: UpdateOnboardingTaskDto,
  ) {
    this.assertSuperAdmin(actor);
    const onboarding = await this.onboardingRepository.findOne({
      where: { id: onboardingId },
    });
    if (!onboarding) {
      throw new NotFoundException('Customer onboarding not found.');
    }
    if (onboarding.status === CUSTOMER_ONBOARDING_STATUS.CANCELLED) {
      throw new BadRequestException('Cancelled onboarding cannot be updated.');
    }

    const task = await this.taskRepository.findOne({
      where: { id: taskId, onboardingId },
    });
    if (!task) {
      throw new NotFoundException('Onboarding task not found.');
    }

    task.status = dto.status;
    if (dto.notes !== undefined) {
      task.notes = dto.notes?.trim() || null;
    }
    if (dto.status === ONBOARDING_TASK_STATUS.COMPLETED) {
      task.completedAt = new Date();
      task.completedBy = actor.id;
    } else {
      task.completedAt = null;
      task.completedBy = null;
    }

    await this.taskRepository.save(task);

    if (
      onboarding.status === CUSTOMER_ONBOARDING_STATUS.NOT_STARTED ||
      onboarding.status === CUSTOMER_ONBOARDING_STATUS.IN_PROGRESS
    ) {
      const tasks = await this.taskRepository.find({ where: { onboardingId } });
      const allDone = tasks.every(
        (item) =>
          item.status === ONBOARDING_TASK_STATUS.COMPLETED ||
          item.status === ONBOARDING_TASK_STATUS.NOT_APPLICABLE,
      );
      if (allDone) {
        onboarding.status = CUSTOMER_ONBOARDING_STATUS.READY_FOR_REVIEW;
        await this.onboardingRepository.save(onboarding);
      } else if (onboarding.status === CUSTOMER_ONBOARDING_STATUS.NOT_STARTED) {
        onboarding.status = CUSTOMER_ONBOARDING_STATUS.IN_PROGRESS;
        await this.onboardingRepository.save(onboarding);
      }
    }

    await this.writeAudit({
      actorUserId: actor.id,
      action: 'onboarding_task_updated',
      targetType: 'onboarding_task',
      targetId: task.id,
      metadata: { onboardingId, status: task.status, taskKey: task.taskKey },
    });

    return this.getOnboarding(actor, onboardingId);
  }

  private async markTaskCompleted(
    onboardingId: number,
    taskKey: OnboardingTaskKey,
    actorUserId: number,
  ): Promise<void> {
    const task = await this.taskRepository.findOne({
      where: { onboardingId, taskKey },
    });
    if (!task) return;
    if (task.status === ONBOARDING_TASK_STATUS.COMPLETED) return;
    task.status = ONBOARDING_TASK_STATUS.COMPLETED;
    task.completedAt = new Date();
    task.completedBy = actorUserId;
    await this.taskRepository.save(task);

    const onboarding = await this.onboardingRepository.findOne({
      where: { id: onboardingId },
    });
    if (
      onboarding &&
      onboarding.status === CUSTOMER_ONBOARDING_STATUS.NOT_STARTED
    ) {
      onboarding.status = CUSTOMER_ONBOARDING_STATUS.IN_PROGRESS;
      await this.onboardingRepository.save(onboarding);
    }
  }

  private async resolveUniqueBusinessSlug(source: string): Promise<string> {
    const base = slugifyBusinessName(source) || 'business';
    const root = isValidBusinessSlug(base) ? base : 'business';
    let candidate = root;
    let suffix = 2;
    while (
      await this.businessRepository.exists({ where: { slug: candidate } })
    ) {
      candidate = `${root}-${suffix}`;
      suffix += 1;
    }
    return candidate;
  }

  private toListItem(row: CustomerOnboarding): CustomerOnboardingListItem {
    const tasks = row.tasks ?? [];
    const progressTotal = tasks.length || ONBOARDING_TASK_KEYS.length;
    const progressCompleted = tasks.filter(
      (task) =>
        task.status === ONBOARDING_TASK_STATUS.COMPLETED ||
        task.status === ONBOARDING_TASK_STATUS.NOT_APPLICABLE,
    ).length;
    return {
      id: row.id,
      meetingId: row.meetingId,
      status: row.status,
      customerName: row.customerName,
      customerEmail: row.customerEmail,
      businessName: row.businessName,
      businessCategory: row.businessCategory,
      selectedPlanId: row.selectedPlanId,
      assignedAdminId: row.assignedAdminId,
      assignedAdminName: row.assignedAdmin?.name ?? null,
      meetingDate: row.meeting?.scheduledDate ?? null,
      meetingTime: row.meeting?.scheduledTime ?? null,
      progressCompleted,
      progressTotal,
      progressPercent:
        progressTotal === 0
          ? 0
          : Math.round((progressCompleted / progressTotal) * 100),
      userId: row.userId,
      businessId: row.businessId,
      updatedAt: row.updatedAt,
      createdAt: row.createdAt,
    };
  }

  private toOnboardingDetail(row: CustomerOnboarding) {
    const tasks = [...(row.tasks ?? [])].sort(
      (a, b) =>
        ONBOARDING_TASK_KEYS.indexOf(a.taskKey as OnboardingTaskKey) -
        ONBOARDING_TASK_KEYS.indexOf(b.taskKey as OnboardingTaskKey),
    );
    const list = this.toListItem({ ...row, tasks });
    return {
      ...list,
      customerPhone: row.customerPhone,
      internalNotes: row.internalNotes,
      draftPayload: row.draftPayload,
      startedAt: row.startedAt,
      approvedAt: row.approvedAt,
      approvedBy: row.approvedBy,
      completedAt: row.completedAt,
      meeting: row.meeting ? this.mapMeeting(row.meeting) : null,
      user: row.user
        ? {
            id: row.user.id,
            name: row.user.name,
            email: row.user.email,
          }
        : null,
      business: row.business
        ? {
            id: row.business.id,
            name: row.business.name,
            slug: row.business.slug,
          }
        : null,
      canStartInvitation: false,
      tasks: tasks.map((task) => ({
        id: task.id,
        taskKey: task.taskKey,
        label:
          ONBOARDING_TASK_LABELS[task.taskKey as OnboardingTaskKey] ??
          task.taskKey,
        status: task.status,
        notes: task.notes,
        completedAt: task.completedAt,
        completedBy: task.completedBy,
        updatedAt: task.updatedAt,
      })),
    };
  }
}

function isUniqueViolation(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error != null &&
    'code' in error &&
    (error as { code?: string }).code === '23505'
  );
}

function isFutureMeeting(row: MeetingRequest, now = Date.now()): boolean {
  if (!row.scheduledDate || !row.scheduledTime) return false;
  const zone = row.scheduledTimeZone?.trim() || 'UTC';
  const [year, month, day] = row.scheduledDate.split('-').map(Number);
  const [hour, minute] = row.scheduledTime.split(':').map(Number);
  const duration = row.scheduledDuration ?? 0;
  const wallUtc = Date.UTC(year, month - 1, day, hour, minute + duration);
  try {
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone: zone,
      hourCycle: 'h23',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    }).formatToParts(new Date(wallUtc));
    const read = (type: Intl.DateTimeFormatPartTypes) =>
      Number(parts.find((part) => part.type === type)?.value ?? '0');
    const zonedAsUtc = Date.UTC(
      read('year'),
      read('month') - 1,
      read('day'),
      read('hour'),
      read('minute'),
      read('second'),
    );
    const offset = Math.round((zonedAsUtc - wallUtc) / 60_000);
    return wallUtc - offset * 60_000 > now;
  } catch {
    return false;
  }
}
