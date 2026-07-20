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
import type { Request } from 'express';
import { BusinessAccessService } from '../business-access/business-access.service';
import { CustomerService } from './customer.service';
import { Customer } from '../../db/entities/customer.entity';
import { RegisterCustomerDto } from './customerDto/register-customer.dto';

type AuthRequest = Request & {
  user: { id: number; email: string; role: { id: number; name: string } };
};

@Controller('customer')
export class CustomerController {
  constructor(
    private readonly customerService: CustomerService,
    private readonly businessAccessService: BusinessAccessService,
  ) {}

  @Post('create')
  async registerCustomer(
    @Body() registerCustomer: RegisterCustomerDto,
  ): Promise<Customer> {
    return this.customerService.registerCustomer(registerCustomer);
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

    return this.customerService.listForBusiness(businessId, page, limit);
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
