import {
  Body,
  Controller,
  DefaultValuePipe,
  Delete,
  ForbiddenException,
  Get,
  Param,
  ParseIntPipe,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { Throttle } from '@nestjs/throttler';
import type { Request } from 'express';
import { requireScannerRole } from '../../utils/require-scanner-role';
import { BusinessAccessService } from '../business-access/business-access.service';
import {
  BusinessPermissionGuard,
  RequireBusinessPermission,
} from '../business-access';
import { CustomerScannerService } from './customer-scanner.service';
import { CustomerService } from './customer.service';
import { Customer } from '../../db/entities/customer.entity';
import { RegisterCustomerDto } from './customerDto/register-customer.dto';
import { ScannerCreateGuestDto } from './customerDto/scanner-create-guest.dto';

type AuthRequest = Request & {
  user: { id: number; email: string; role: { id: number; name: string } };
};

@Controller('customer')
export class CustomerController {
  constructor(
    private readonly customerService: CustomerService,
    private readonly customerScannerService: CustomerScannerService,
    private readonly businessAccessService: BusinessAccessService,
  ) {}

  @Post('create')
  async registerCustomer(
    @Body() registerCustomer: RegisterCustomerDto,
  ): Promise<Customer & { isNewCustomer: boolean }> {
    return this.customerService.registerCustomer(registerCustomer);
  }

  @UseGuards(AuthGuard('jwt'), BusinessPermissionGuard)
  @RequireBusinessPermission('scanning')
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  @Post('business/:businessId/scanner/guests')
  async createScannerGuest(
    @Param('businessId', ParseIntPipe) businessId: number,
    @Body() dto: ScannerCreateGuestDto,
    @Req() req: AuthRequest,
  ): Promise<Customer & { isNewCustomer: boolean }> {
    requireScannerRole(req.user);
    return this.customerScannerService.createGuestForBusiness(businessId, dto);
  }

  @UseGuards(AuthGuard('jwt'), BusinessPermissionGuard)
  @RequireBusinessPermission('scanning')
  @Throttle({ default: { limit: 60, ttl: 60_000 } })
  @Get('business/:businessId/scanner/guests/search')
  async searchScannerGuests(
    @Param('businessId', ParseIntPipe) businessId: number,
    @Query('q') query = '',
    @Query('page', new DefaultValuePipe(1), ParseIntPipe) page: number,
    @Query('limit', new DefaultValuePipe(10), ParseIntPipe) limit: number,
    @Req() req: AuthRequest,
  ) {
    requireScannerRole(req.user);
    return this.customerScannerService.searchGuestsForBusiness(
      businessId,
      query,
      page,
      limit,
    );
  }

  @UseGuards(AuthGuard('jwt'))
  @Get('business/:businessId/joining-trend')
  async getBusinessJoiningTrend(
    @Param('businessId', ParseIntPipe) businessId: number,
    @Query('months', new DefaultValuePipe(6), ParseIntPipe) months: number,
    @Req() req: AuthRequest,
  ) {
    const context = await this.businessAccessService.getAccessContext(
      {
        id: req.user.id,
        email: req.user.email,
        role: req.user.role,
      },
      businessId,
    );

    if (!context) {
      throw new ForbiddenException(
        'Business not found or you do not have access to this business.',
      );
    }

    return this.customerService.getJoiningTrendForBusiness(businessId, months);
  }

  @UseGuards(AuthGuard('jwt'))
  @Get('business/:businessId')
  async listBusinessCustomers(
    @Param('businessId', ParseIntPipe) businessId: number,
    @Query('page', new DefaultValuePipe(1), ParseIntPipe) page: number,
    @Query('limit', new DefaultValuePipe(10), ParseIntPipe) limit: number,
    @Query('from') fromRaw: string | undefined,
    @Query('to') toRaw: string | undefined,
    @Req() req: AuthRequest,
  ) {
    const context = await this.businessAccessService.getAccessContext(
      {
        id: req.user.id,
        email: req.user.email,
        role: req.user.role,
      },
      businessId,
    );

    if (!context) {
      throw new ForbiddenException(
        'Business not found or you do not have access to this business.',
      );
    }

    return this.customerService.listForBusiness(businessId, page, limit, {
      from: fromRaw,
      to: toRaw,
    });
  }

  @UseGuards(AuthGuard('jwt'))
  @Get('search')
  searchCustomers(
    @Query('q') query = '',
    @Query('page', new DefaultValuePipe(1), ParseIntPipe) page: number,
    @Query('limit', new DefaultValuePipe(10), ParseIntPipe) limit: number,
  ) {
    return this.customerService.searchCustomers(query, page, limit);
  }

  @UseGuards(AuthGuard('jwt'))
  @Get()
  listCustomers(
    @Query('page', new DefaultValuePipe(1), ParseIntPipe) page: number,
    @Query('limit', new DefaultValuePipe(10), ParseIntPipe) limit: number,
  ) {
    return this.customerService.findAllPaginated(page, limit);
  }

  @UseGuards(AuthGuard('jwt'))
  @Delete(':id')
  async deleteCustomer(@Param('id', ParseIntPipe) id: number) {
    await this.customerService.deleteCustomer(id);
    return { success: true };
  }
}
