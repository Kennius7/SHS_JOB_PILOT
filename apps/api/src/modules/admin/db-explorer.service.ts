import { Injectable, BadRequestException, NotFoundException } from '@nestjs/common';
import { PrismaService } from '@shs/data';

export interface ColumnMeta {
  name: string;
  dataType: string;
  nullable: boolean;
  isPrimaryKey: boolean;
}

export interface RowsQuery {
  page: number;
  limit: number;
  orderBy?: string;
  order: 'asc' | 'desc';
  q?: string;
}

const IDENT = /^[A-Za-z_][A-Za-z0-9_]*$/;

const escapeLike = (value: string) => value.replace(/[\\%_]/g, (m) => `\\${m}`);

/** Convert a raw database value into something `JSON.stringify` can handle. */
export function toJsonValue(value: unknown): unknown {
  if (value === null || value === undefined) return null;
  const type = typeof value;
  if (type === 'bigint') return (value as bigint).toString();
  if (type === 'string' || type === 'number' || type === 'boolean') return value;
  if (value instanceof Date) return value.toISOString();
  if (Buffer.isBuffer(value)) return `<buffer ${value.length} bytes>`;
  if (value instanceof Uint8Array) return `<bytes ${value.length}>`;
  if (Array.isArray(value)) return value.map(toJsonValue);
  if (type === 'object') {
    const obj = value as { toNumber?: unknown; toString?: () => string };
    // Prisma.Decimal and friends expose toNumber/toString; render as a string.
    if (typeof obj.toNumber === 'function' && typeof obj.toString === 'function') {
      return obj.toString();
    }
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([k, v]) => [k, toJsonValue(v)]),
    );
  }
  return String(value);
}

/**
 * Read-only Postgres browser for the admin console. Every SQL statement that
 * interpolates an identifier first validates it against the live catalog, so
 * arbitrary table/column names cannot be injected.
 */
@Injectable()
export class DbExplorerService {
  constructor(private prisma: PrismaService) {}

  async tables() {
    const rows = await this.prisma.$queryRawUnsafe<{ name: string }[]>(
      `SELECT table_name AS name FROM information_schema.tables
       WHERE table_schema = 'public' AND table_type = 'BASE TABLE'
       ORDER BY table_name`,
    );
    const tables = await Promise.all(
      rows.map(async (row) => {
        if (!IDENT.test(row.name)) return { name: row.name, rows: 0 };
        const count = await this.prisma.$queryRawUnsafe<{ count: bigint }[]>(
          `SELECT COUNT(*)::bigint AS count FROM "public"."${row.name}"`,
        );
        return { name: row.name, rows: Number(count[0]?.count ?? 0) };
      }),
    );
    return { tables };
  }

  async rows(table: string, query: RowsQuery) {
    await this.assertTable(table);
    const columns = await this.columns(table);
    const columnNames = columns.map((c) => c.name);
    if (!columnNames.length) {
      return {
        table,
        columns,
        rows: [],
        total: 0,
        page: query.page,
        limit: query.limit,
        orderBy: null,
        order: query.order,
      };
    }

    const orderBy =
      query.orderBy && columnNames.includes(query.orderBy)
        ? query.orderBy
        : (columns.find((c) => c.isPrimaryKey)?.name ?? columnNames[0]);
    const direction = query.order === 'desc' ? 'DESC' : 'ASC';

    const filterParams: unknown[] = [];
    let where = '';
    if (query.q) {
      filterParams.push(`%${escapeLike(query.q)}%`);
      where = ` WHERE (${columnNames.map((c) => `"${c}"::text ILIKE $1`).join(' OR ')})`;
    }

    const offset = (query.page - 1) * query.limit;
    const rowsSql =
      `SELECT * FROM "public"."${table}"${where} ORDER BY "${orderBy}" ${direction} ` +
      `LIMIT $${filterParams.length + 1} OFFSET $${filterParams.length + 2}`;
    const countSql = `SELECT COUNT(*)::bigint AS count FROM "public"."${table}"${where}`;

    const [raw, countRows] = await Promise.all([
      this.prisma.$queryRawUnsafe<Record<string, unknown>[]>(
        rowsSql,
        ...filterParams,
        query.limit,
        offset,
      ),
      this.prisma.$queryRawUnsafe<{ count: bigint }[]>(countSql, ...filterParams),
    ]);

    return {
      table,
      columns,
      rows: raw.map((row) =>
        Object.fromEntries(Object.entries(row).map(([k, v]) => [k, toJsonValue(v)])),
      ),
      total: Number(countRows[0]?.count ?? 0),
      page: query.page,
      limit: query.limit,
      orderBy,
      order: query.order,
    };
  }

  private async assertTable(table: string): Promise<void> {
    if (!IDENT.test(table)) throw new BadRequestException('Invalid table name');
    const found = await this.prisma.$queryRawUnsafe<{ name: string }[]>(
      `SELECT table_name AS name FROM information_schema.tables
       WHERE table_schema = 'public' AND table_type = 'BASE TABLE' AND table_name::text = $1`,
      table,
    );
    if (!found.length) throw new NotFoundException(`Table "${table}" was not found`);
  }

  private async columns(table: string): Promise<ColumnMeta[]> {
    const columns = await this.prisma.$queryRawUnsafe<
      { name: string; dataType: string; nullable: string }[]
    >(
      `SELECT column_name AS name, data_type AS "dataType", is_nullable AS nullable
       FROM information_schema.columns
       WHERE table_schema = 'public' AND table_name::text = $1
       ORDER BY ordinal_position`,
      table,
    );
    const pks = await this.prisma.$queryRawUnsafe<{ name: string }[]>(
      `SELECT kcu.column_name AS name
       FROM information_schema.table_constraints tc
       JOIN information_schema.key_column_usage kcu
         ON tc.constraint_name = kcu.constraint_name
        AND tc.table_schema = kcu.table_schema
        AND tc.table_name = kcu.table_name
       WHERE tc.table_schema = 'public' AND tc.table_name::text = $1
         AND tc.constraint_type = 'PRIMARY KEY'
       ORDER BY kcu.ordinal_position`,
      table,
    );
    const pkSet = new Set(pks.map((p) => p.name));
    return columns.map((c) => ({
      name: c.name,
      dataType: c.dataType,
      nullable: c.nullable === 'YES',
      isPrimaryKey: pkSet.has(c.name),
    }));
  }
}
