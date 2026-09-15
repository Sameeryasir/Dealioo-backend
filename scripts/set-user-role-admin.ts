/**
 * Set a user's platform role to Admin.
 * Usage: npx ts-node -r tsconfig-paths/register scripts/set-user-role-admin.ts [email]
 */
import 'reflect-metadata';
import { config } from 'dotenv';
import AppDataSource from '../src/data-source';
import { ADMIN_ROLE } from '../src/utils/user-roles';

config();

const TARGET_EMAIL = (process.argv[2] ?? 'sameeryasir02@gmail.com')
  .trim()
  .toLowerCase();

async function main() {
  if (!TARGET_EMAIL.includes('@')) {
    throw new Error('A valid email is required.');
  }

  await AppDataSource.initialize();

  try {
    const adminRole = await AppDataSource.query(
      `SELECT id, name FROM roles WHERE name = $1 LIMIT 1`,
      [ADMIN_ROLE],
    );
    if (!adminRole.length) {
      throw new Error(`Role "${ADMIN_ROLE}" was not found.`);
    }

    const users = await AppDataSource.query(
      `
        SELECT u.id, u.email, u.name, r.name AS role_name
        FROM users u
        INNER JOIN roles r ON r.id = u.role_id
        WHERE LOWER(u.email) = $1
        LIMIT 1
      `,
      [TARGET_EMAIL],
    );
    if (!users.length) {
      throw new Error(`User ${TARGET_EMAIL} was not found.`);
    }

    const user = users[0] as {
      id: number;
      email: string;
      name: string;
      role_name: string;
    };

    if (user.role_name === ADMIN_ROLE) {
      console.log(
        `Already Admin: ${user.email} (id ${user.id}, ${user.name})`,
      );
      return;
    }

    await AppDataSource.query(
      `UPDATE users SET role_id = $1, updated_at = NOW() WHERE id = $2`,
      [adminRole[0].id, user.id],
    );

    console.log(
      `Updated ${user.email} (id ${user.id}) from "${user.role_name}" to ${ADMIN_ROLE}.`,
    );
  } finally {
    await AppDataSource.destroy();
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
