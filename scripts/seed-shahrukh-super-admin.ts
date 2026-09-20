import 'reflect-metadata';
import * as bcrypt from 'bcrypt';
import { config } from 'dotenv';
import AppDataSource from '../src/data-source';
import { Role } from '../src/db/entities/role.entity';
import { User } from '../src/db/entities/user.entity';
import { SUPER_ADMIN_ROLE } from '../src/utils/user-roles';

config();

const EMAIL = 'shahrukh@gmail.com';
const PASSWORD = 'secret@1234';
const DISPLAY_NAME = 'Shahrukh';

async function main(): Promise<void> {
  await AppDataSource.initialize();

  const roleRepo = AppDataSource.getRepository(Role);
  const userRepo = AppDataSource.getRepository(User);

  let role = await roleRepo.findOne({ where: { name: SUPER_ADMIN_ROLE } });
  if (!role) {
    role = await roleRepo.save(roleRepo.create({ name: SUPER_ADMIN_ROLE }));
    console.log(`INSERT role ${SUPER_ADMIN_ROLE}`);
  }

  const existing = await userRepo
    .createQueryBuilder('user')
    .addSelect('user.passwordHash')
    .leftJoinAndSelect('user.role', 'role')
    .where('LOWER(user.email) = :email', { email: EMAIL })
    .getOne();

  const passwordHash = await bcrypt.hash(PASSWORD, 10);

  if (existing) {
    existing.email = EMAIL;
    existing.name = existing.name?.trim() || DISPLAY_NAME;
    existing.passwordHash = passwordHash;
    existing.provider = 'LOCAL';
    existing.role = role;
    existing.isActive = true;
    existing.emailVerified = true;
    await userRepo.save(existing);
    console.log(`UPDATE ${EMAIL} role=${SUPER_ADMIN_ROLE} id=${existing.id}`);
  } else {
    const created = await userRepo.save(
      userRepo.create({
        email: EMAIL,
        name: DISPLAY_NAME,
        firstName: DISPLAY_NAME,
        phone: null,
        passwordHash,
        provider: 'LOCAL',
        role,
        isActive: true,
        emailVerified: true,
      }),
    );
    console.log(`INSERT ${EMAIL} role=${SUPER_ADMIN_ROLE} id=${created.id}`);
  }

  await AppDataSource.destroy();
}

main().catch(async (error) => {
  console.error(error instanceof Error ? error.message : error);
  if (AppDataSource.isInitialized) {
    await AppDataSource.destroy();
  }
  process.exit(1);
});
