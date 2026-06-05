import {
  Body,
  Controller,
  DefaultValuePipe,
  Delete,
  Get,
  Param,
  ParseIntPipe,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { CustomerService } from './customer.service';
import { Customer } from 'src/db/entities/customer.entity';
import { RegisterCustomerDto } from './customerDto/register-customer.dto';
@Controller('customer')
export class CustomerController {
    constructor(private readonly customerService:CustomerService){}
    @Post('create')
    async registerCustomer(@Body()registerCustomer:RegisterCustomerDto):Promise<Customer>{
        return this.customerService.registerCustomer(registerCustomer);
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
