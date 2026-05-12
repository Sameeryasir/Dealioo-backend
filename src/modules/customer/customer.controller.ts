import { Body, Controller, Post } from '@nestjs/common';
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
}
