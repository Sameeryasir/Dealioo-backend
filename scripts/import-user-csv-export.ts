/**
 * Import a user CSV export (sameeryasir02-gmail-com-db-export.csv) into the
 * configured Postgres DB, then set that user's password for email login.
 *
 * Usage:
 *   npx ts-node -r tsconfig-paths/register scripts/import-user-csv-export.ts \
 *     ./sameeryasir02-gmail-com-db-export.csv
 *
 * Password applied to sameeryasir02@gmail.com: secret@1234
 *
 * Notes:
 * - Upserts by primary key (safe to re-run)
 * - Skips refresh_tokens (redacted / useless for login)
 * - Replaces [REDACTED] secrets with NULL or deterministic placeholders
 * - Temporarily disables FK checks (session_replication_role = replica)
 */
import { createHash } from 'crypto';
import { existsSync, readFileSync } from 'fs';
import { resolve } from 'path';
import * as bcrypt from 'bcrypt';
import { config } from 'dotenv';
import { Client } from 'pg';

config();

const DEFAULT_CSV = resolve(
  __dirname,
  '../sameeryasir02-gmail-com-db-export.csv',
);
const TARGET_EMAIL = 'sameeryasir02@gmail.com';
const TARGET_PASSWORD = 'secret@1234';
const SKIP_TABLES = new Set(['refresh_tokens']);

type CsvRow = {
  table_name: string;
  match_reason: string;
  record_json: string;
};

type ColumnMeta = {
  dataType: string;
  udtName: string;
  isNullable: boolean;
};

function env(name: string, fallback?: string): string {
  const value = process.env[name] ?? fallback;
  if (!value) {
    throw new Error(`Missing env ${name}`);
  }
  return value;
}

/** Minimal RFC4180 CSV line parser (export is one record per line). */
function parseCsvLine(line: string): string[] {
  const out: string[] = [];
  let cur = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i]!;
    if (inQuotes) {
      if (ch === '"') {
        if (line[i + 1] === '"') {
          cur += '"';
          i += 1;
        } else {
          inQuotes = false;
        }
      } else {
        cur += ch;
      }
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === ',') {
      out.push(cur);
      cur = '';
    } else {
      cur += ch;
    }
  }
  out.push(cur);
  return out;
}

function readCsv(path: string): CsvRow[] {
  const text = readFileSync(path, 'utf8');
  const lines = text.split(/\r?\n/).filter((line) => line.length > 0);
  if (lines.length < 2) return [];

  const header = parseCsvLine(lines[0]!);
  const tableIdx = header.indexOf('table_name');
  const reasonIdx = header.indexOf('match_reason');
  const jsonIdx = header.indexOf('record_json');
  if (tableIdx < 0 || reasonIdx < 0 || jsonIdx < 0) {
    throw new Error(
      'CSV missing required columns table_name, match_reason, record_json',
    );
  }

  const rows: CsvRow[] = [];
  for (const line of lines.slice(1)) {
    const cols = parseCsvLine(line);
    rows.push({
      table_name: cols[tableIdx] ?? '',
      match_reason: cols[reasonIdx] ?? '',
      record_json: cols[jsonIdx] ?? '',
    });
  }
  return rows;
}

function placeholderSecret(table: string, id: string, column: string): string {
  return createHash('sha256')
    .update(`import:${table}:${id}:${column}`)
    .digest('hex')
    .slice(0, 64);
}

function coerceValue(
  raw: unknown,
  meta: ColumnMeta,
  table: string,
  id: string,
  column: string,
): unknown {
  const { dataType, udtName } = meta;
  const isJsonColumn =
    udtName === 'jsonb' ||
    udtName === 'json' ||
    dataType === 'jsonb' ||
    dataType === 'json';

  if (raw === '[REDACTED]') {
    if (
      !meta.isNullable &&
      (column.includes('token') ||
        column.includes('hash') ||
        column.includes('secret'))
    ) {
      return placeholderSecret(table, id, column);
    }
    return null;
  }

  if (raw === '' || raw === undefined) {
    return null;
  }

  // node-pg turns JS arrays into Postgres {a,b} literals — never pass
  // objects/arrays directly into json/jsonb columns.
  if (raw !== null && typeof raw === 'object') {
    if (isJsonColumn) {
      return JSON.stringify(raw);
    }
    return raw;
  }

  if (typeof raw !== 'string') {
    return raw;
  }

  if (dataType === 'boolean' || udtName === 'bool') {
    if (raw === 't' || raw === 'true' || raw === '1') return true;
    if (raw === 'f' || raw === 'false' || raw === '0') return false;
    return null;
  }

  if (
    dataType.includes('int') ||
    udtName === 'int2' ||
    udtName === 'int4' ||
    udtName === 'int8'
  ) {
    const n = Number(raw);
    return Number.isFinite(n) ? n : null;
  }

  if (
    dataType === 'numeric' ||
    dataType === 'real' ||
    dataType === 'double precision' ||
    udtName === 'numeric' ||
    udtName === 'float4' ||
    udtName === 'float8'
  ) {
    const n = Number(raw);
    return Number.isFinite(n) ? n : null;
  }

  if (isJsonColumn) {
    const trimmed = raw.trim();
    if (!trimmed) return null;
    try {
      return JSON.stringify(JSON.parse(trimmed));
    } catch {
      return JSON.stringify(trimmed);
    }
  }

  return raw;
}

async function loadColumnMeta(
  client: Client,
  table: string,
): Promise<Map<string, ColumnMeta>> {
  const result = await client.query<{
    column_name: string;
    data_type: string;
    udt_name: string;
    is_nullable: string;
  }>(
    `
    SELECT column_name, data_type, udt_name, is_nullable
    FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = $1
    `,
    [table],
  );

  const map = new Map<string, ColumnMeta>();
  for (const row of result.rows) {
    map.set(row.column_name, {
      dataType: row.data_type,
      udtName: row.udt_name,
      isNullable: row.is_nullable === 'YES',
    });
  }
  return map;
}

async function loadPrimaryKey(
  client: Client,
  table: string,
): Promise<string[]> {
  const result = await client.query<{ column_name: string }>(
    `
    SELECT kcu.column_name
    FROM information_schema.table_constraints tc
    JOIN information_schema.key_column_usage kcu
      ON tc.constraint_name = kcu.constraint_name
     AND tc.table_schema = kcu.table_schema
    WHERE tc.table_schema = 'public'
      AND tc.table_name = $1
      AND tc.constraint_type = 'PRIMARY KEY'
    ORDER BY kcu.ordinal_position
    `,
    [table],
  );
  return result.rows.map((r) => r.column_name);
}

async function upsertRow(
  client: Client,
  table: string,
  record: Record<string, unknown>,
  columns: Map<string, ColumnMeta>,
  pkCols: string[],
): Promise<void> {
  const idHint = String(record.id ?? record[pkCols[0] ?? ''] ?? 'unknown');

  const usableEntries: Array<[string, unknown]> = [];
  for (const [key, raw] of Object.entries(record)) {
    const meta = columns.get(key);
    if (!meta) continue;
    usableEntries.push([key, coerceValue(raw, meta, table, idHint, key)]);
  }

  if (usableEntries.length === 0 || pkCols.length === 0) return;

  const colNames = usableEntries.map(([k]) => k);
  const values = usableEntries.map(([, v]) => v);
  const placeholders = values.map((_, i) => `$${i + 1}`);
  const updateCols = colNames.filter((c) => !pkCols.includes(c));
  const conflictTarget = pkCols.map((c) => `"${c}"`).join(', ');

  const sql =
    updateCols.length === 0
      ? `
      INSERT INTO "${table}" (${colNames.map((c) => `"${c}"`).join(', ')})
      VALUES (${placeholders.join(', ')})
      ON CONFLICT (${conflictTarget}) DO NOTHING
    `
      : `
      INSERT INTO "${table}" (${colNames.map((c) => `"${c}"`).join(', ')})
      VALUES (${placeholders.join(', ')})
      ON CONFLICT (${conflictTarget}) DO UPDATE SET
      ${updateCols.map((c) => `"${c}" = EXCLUDED."${c}"`).join(', ')}
    `;

  await client.query(sql, values);
}

async function resetSequences(client: Client, tables: string[]): Promise<void> {
  for (const table of tables) {
    const pk = await loadPrimaryKey(client, table);
    if (pk.length !== 1) continue;
    const pkCol = pk[0]!;
    const meta = (await loadColumnMeta(client, table)).get(pkCol);
    if (!meta || !meta.dataType.includes('int')) continue;

    await client
      .query(
        `
      SELECT setval(
        pg_get_serial_sequence($1, $2),
        COALESCE((SELECT MAX("${pkCol}") FROM "${table}"), 1),
        true
      )
      `,
        [table, pkCol],
      )
      .catch(() => undefined);
  }
}

async function setUserPassword(client: Client): Promise<void> {
  const passwordHash = await bcrypt.hash(TARGET_PASSWORD, 10);
  const result = await client.query(
    `
    UPDATE users
    SET
      password_hash = $1,
      email_verified = true,
      is_active = true,
      updated_at = NOW()
    WHERE lower(email) = lower($2)
    RETURNING id, email
    `,
    [passwordHash, TARGET_EMAIL],
  );

  if (result.rowCount !== 1) {
    throw new Error(
      `Password update failed — expected 1 user for ${TARGET_EMAIL}, got ${result.rowCount}`,
    );
  }

  console.log(
    `Password set for ${result.rows[0].email} (id=${result.rows[0].id}) → ${TARGET_PASSWORD}`,
  );
}

async function main(): Promise<void> {
  const csvPath = resolve(process.argv[2] ?? DEFAULT_CSV);
  console.log(`Reading CSV: ${csvPath}`);

  if (!existsSync(csvPath)) {
    throw new Error(
      `CSV not found at ${csvPath}. From the backend folder run:\n` +
        `  npx ts-node -r tsconfig-paths/register scripts/import-user-csv-export.ts\n` +
        `or:\n` +
        `  npx ts-node -r tsconfig-paths/register scripts/import-user-csv-export.ts ./sameeryasir02-gmail-com-db-export.csv\n` +
        `(Do not use ../ — the CSV lives inside the backend directory.)`,
    );
  }

  const csvRows = readCsv(csvPath);
  console.log(`CSV rows: ${csvRows.length}`);

  const byTable = new Map<string, Record<string, unknown>[]>();
  for (const row of csvRows) {
    if (!row.table_name || SKIP_TABLES.has(row.table_name)) continue;
    let record: Record<string, unknown>;
    try {
      record = JSON.parse(row.record_json) as Record<string, unknown>;
    } catch {
      console.warn(`Skip bad JSON in table=${row.table_name}`);
      continue;
    }
    const list = byTable.get(row.table_name) ?? [];
    list.push(record);
    byTable.set(row.table_name, list);
  }

  const preferredOrder = [
    'users',
    'roles',
    'businesses',
    'business_members',
    'business_member_permissions',
    'customers',
    'campaigns',
    'funnels',
    'funnel_versions',
    'funnel_page_versions',
  ];
  const tables = [
    ...preferredOrder.filter((t) => byTable.has(t)),
    ...[...byTable.keys()].filter((t) => !preferredOrder.includes(t)).sort(),
  ];

  const client = new Client({
    host: env('DB_HOST', 'localhost'),
    port: Number(env('DB_PORT', '5432')),
    user: env('DB_USERNAME'),
    password: env('DB_PASSWORD'),
    database: env('DB_NAME'),
  });

  await client.connect();
  console.log(`Connected to ${env('DB_NAME')} as ${env('DB_USERNAME')}`);

  try {
    await client.query('BEGIN');
    await client.query(
      "SELECT set_config('session_replication_role', 'replica', true)",
    );

    const stats: Record<string, number> = {};

    for (const table of tables) {
      const records = byTable.get(table) ?? [];
      const columns = await loadColumnMeta(client, table);
      if (columns.size === 0) {
        console.warn(`Skip missing table: ${table}`);
        continue;
      }
      const pkCols = await loadPrimaryKey(client, table);
      if (pkCols.length === 0) {
        console.warn(`Skip table without PK: ${table}`);
        continue;
      }

      let ok = 0;
      for (const record of records) {
        await upsertRow(client, table, record, columns, pkCols);
        ok += 1;
      }
      stats[table] = ok;
      console.log(`Upserted ${ok} → ${table}`);
    }

    await resetSequences(client, tables);
    await setUserPassword(client);

    await client.query('COMMIT');
    console.log('Import committed.');
    console.log(
      'Summary:',
      Object.fromEntries(
        Object.entries(stats).sort((a, b) => a[0].localeCompare(b[0])),
      ),
    );
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    await client.end();
  }
}

main().catch((error) => {
  console.error('Import failed:', error);
  process.exit(1);
});
