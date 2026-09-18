import 'reflect-metadata';
import { config } from 'dotenv';
import AppDataSource from '../src/data-source';

config();

const ROLE_NAMES = [
  'Admin',
  'Super Admin',
  'Member',
  'Manager',
  'Staff',
  'Scanner',
];

async function main(): Promise<void> {
  await AppDataSource.initialize();

  let inserted = 0;
  for (const name of ROLE_NAMES) {
    const existing = (await AppDataSource.query(
      `SELECT id FROM roles WHERE name = $1 LIMIT 1`,
      [name],
    )) as Array<{ id: number }>;
    if (existing[0]) {
      console.log(`OK     ${name}`);
      continue;
    }
    await AppDataSource.query(`INSERT INTO roles (name) VALUES ($1)`, [name]);
    inserted += 1;
    console.log(`INSERT ${name}`);
  }

  const rows = (await AppDataSource.query(
    `SELECT id, name FROM roles ORDER BY id`,
  )) as Array<{ id: number; name: string }>;
  console.log('---');
  console.log(`Done. inserted=${inserted}`);
  for (const row of rows) {
    console.log(`${row.id} ${row.name}`);
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
