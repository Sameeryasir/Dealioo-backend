import 'reflect-metadata';
import { DataSource } from 'typeorm';
import { config } from 'dotenv';

config();

const useBaseline = process.env.MIGRATIONS_DIR !== 'migrations';
const migrationsDir = useBaseline
  ? 'src/db/migrations-baseline/*.ts'
  : 'src/db/migrations/*.ts';

const AppDataSource = new DataSource({
  type: 'postgres',
  host: process.env.DB_HOST,
  port: process.env.DB_PORT ? parseInt(process.env.DB_PORT, 10) : 5433,
  username: process.env.DB_USERNAME,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME,
  ssl: process.env.DB_SSL === 'true' ? { rejectUnauthorized: false } : false,
  entities: ['src/db/entities/*.entity.ts'],
  migrations: [migrationsDir],
  migrationsTableName: useBaseline ? 'migrations_baseline' : 'migrations',
});

export default AppDataSource;
