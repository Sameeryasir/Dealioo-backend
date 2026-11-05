import { ForbiddenException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { BusinessAccessService } from '../business-access/business-access.service';
import { CustomerScannerService } from './customer-scanner.service';
import { CustomerController } from './customer.controller';
import { CustomerService } from './customer.service';

describe('CustomerController', () => {
  let controller: CustomerController;
  const customerService = {
    registerCustomer: jest.fn(),
    getJoiningTrendForBusiness: jest.fn(),
    listForBusiness: jest.fn(),
    searchCustomers: jest.fn(),
    findAllPaginated: jest.fn(),
    deleteCustomer: jest.fn(),
  };
  const customerScannerService = {
    searchGuestsForBusiness: jest.fn(),
    createGuestForBusiness: jest.fn(),
  };
  const businessAccessService = {
    getAccessContext: jest.fn(),
  };

  beforeEach(async () => {
    jest.clearAllMocks();
    const module: TestingModule = await Test.createTestingModule({
      controllers: [CustomerController],
      providers: [
        { provide: CustomerService, useValue: customerService },
        { provide: CustomerScannerService, useValue: customerScannerService },
        { provide: BusinessAccessService, useValue: businessAccessService },
      ],
    }).compile();

    controller = module.get(CustomerController);
  });

  it('keeps public signup on POST /customer/create', async () => {
    customerService.registerCustomer.mockResolvedValue({
      id: 1,
      isNewCustomer: true,
    });

    await controller.registerCustomer({
      name: 'Public Guest',
      email: 'public@example.com',
      phone: '555',
    });

    expect(customerService.registerCustomer).toHaveBeenCalled();
  });

  it('creates scanner guests through the business-scoped service', async () => {
    customerScannerService.createGuestForBusiness.mockResolvedValue({
      id: 2,
      isNewCustomer: true,
    });

    await controller.createScannerGuest(
      10,
      { name: 'Staff Guest', email: 'staff@example.com', phone: '555' },
      {
        user: {
          id: 99,
          email: 'owner@example.com',
          role: { id: 1, name: 'Member' },
        },
      } as never,
    );

    expect(customerScannerService.createGuestForBusiness).toHaveBeenCalledWith(
      10,
      {
        name: 'Staff Guest',
        email: 'staff@example.com',
        phone: '555',
      },
    );
  });

  it('searches scanner guests through the business-scoped service', async () => {
    customerScannerService.searchGuestsForBusiness.mockResolvedValue({
      data: [],
      meta: { page: 1, limit: 10, total: 0, totalPages: 0 },
    });

    await controller.searchScannerGuests(
      10,
      'ada',
      1,
      10,
      {
        user: {
          id: 99,
          email: 'owner@example.com',
          role: { id: 1, name: 'Member' },
        },
      } as never,
    );

    expect(customerScannerService.searchGuestsForBusiness).toHaveBeenCalledWith(
      10,
      'ada',
      1,
      10,
    );
  });

  it('rejects scanner create for unsupported platform roles', async () => {
    await expect(
      controller.createScannerGuest(
        10,
        { name: 'Nope', email: 'n@example.com', phone: '555' },
        {
          user: {
            id: 5,
            email: 'guest@example.com',
            role: { id: 9, name: 'Customer' },
          },
        } as never,
      ),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(customerScannerService.createGuestForBusiness).not.toHaveBeenCalled();
  });

  it('rejects scanner search for unsupported platform roles', async () => {
    await expect(
      controller.searchScannerGuests(
        10,
        'ada',
        1,
        10,
        {
          user: {
            id: 5,
            email: 'guest@example.com',
            role: { id: 9, name: 'Customer' },
          },
        } as never,
      ),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(
      customerScannerService.searchGuestsForBusiness,
    ).not.toHaveBeenCalled();
  });
});
