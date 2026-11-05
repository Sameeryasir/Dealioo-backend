import { CustomerScannerService } from './customer-scanner.service';
import { CustomerService } from './customer.service';

describe('CustomerScannerService', () => {
  const customerRepository = {
    createQueryBuilder: jest.fn(),
  };
  const customerService = {
    registerCustomer: jest.fn(),
  };

  let service: CustomerScannerService;

  beforeEach(() => {
    jest.clearAllMocks();
    service = new CustomerScannerService(
      customerRepository as never,
      customerService as unknown as CustomerService,
    );
  });

  it('returns empty results for short queries without hitting the database', async () => {
    const result = await service.searchGuestsForBusiness(12, 'a', 1, 10);

    expect(result.data).toEqual([]);
    expect(result.meta.total).toBe(0);
    expect(customerRepository.createQueryBuilder).not.toHaveBeenCalled();
  });

  it('scopes search queries to the requested business', async () => {
    const qb = {
      select: jest.fn().mockReturnThis(),
      where: jest.fn().mockReturnThis(),
      andWhere: jest.fn().mockReturnThis(),
      setParameter: jest.fn().mockReturnThis(),
      orderBy: jest.fn().mockReturnThis(),
      skip: jest.fn().mockReturnThis(),
      take: jest.fn().mockReturnThis(),
      getManyAndCount: jest.fn().mockResolvedValue([
        [{ id: 7, name: 'Ada', email: 'ada@example.com', phone: '555' }],
        1,
      ]),
    };
    customerRepository.createQueryBuilder.mockReturnValue(qb);

    const result = await service.searchGuestsForBusiness(42, 'ada', 1, 10);

    expect(customerRepository.createQueryBuilder).toHaveBeenCalledWith(
      'customer',
    );
    expect(qb.setParameter).toHaveBeenCalledWith('businessId', 42);
    expect(qb.andWhere).toHaveBeenCalled();
    expect(result.data).toEqual([
      { id: 7, name: 'Ada', email: 'ada@example.com', phone: '555' },
    ]);
    expect(result.meta.total).toBe(1);
  });

  it('creates guests with duplicate rejection and route businessId', async () => {
    customerService.registerCustomer.mockResolvedValue({
      id: 9,
      isNewCustomer: true,
    });

    await service.createGuestForBusiness(55, {
      name: 'Sam Guest',
      email: 'sam@example.com',
      phone: '+15551212',
    });

    expect(customerService.registerCustomer).toHaveBeenCalledWith({
      name: 'Sam Guest',
      email: 'sam@example.com',
      phone: '+15551212',
      rejectDuplicateEmail: true,
      rejectDuplicatePhone: true,
      businessId: 55,
    });
  });
});
