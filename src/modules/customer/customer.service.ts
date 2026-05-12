import { ConflictException, Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Customer } from '../../db/entities/customer.entity';
import { RegisterCustomerDto } from './customerDto/register-customer.dto';

@Injectable()
export class CustomerService {
  constructor(
    @InjectRepository(Customer)
    private readonly customerRepository: Repository<Customer>,
  ) {}

  async registerCustomer(dto: RegisterCustomerDto): Promise<Customer> {
    const existing = await this.customerRepository.findOne({
      where: { email: dto.email },
    });
    if (existing) {
      throw new ConflictException('A customer with this email already exists');
    }

    const customer = this.customerRepository.create({
      name: dto.name,
      email: dto.email,
      phone: dto.phone?.trim() || null,
    });

    return this.customerRepository.save(customer);
  }
}
