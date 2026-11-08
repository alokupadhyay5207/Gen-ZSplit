/**
 * Supabase connection and small query helpers for Gen-ZSplit.
 *
 * Every database call in the app goes through the helpers below, so the rest of
 * the code never touches the Supabase client directly. Server-only: the key is the
 * secret / service_role key and must never reach the browser.
 */
import "server-only";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type Row = Record<string, any>;
export type Where = Record<string, unknown>;
export type Order = Array<[column: string, descending: boolean]>;

const PAGE = 1000; // Supabase/PostgREST returns at most 1000 rows per request

/** Raised when an insert violates a UNIQUE constraint (Postgres code 23505). */
export class DuplicateKeyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DuplicateKeyError";
  }
}

export class DatabaseError extends Error {
  code?: string;
  constructor(message: string, code?: string) {
    super(message);
    this.name = "DatabaseError";
    this.code = code;
  }
}

let client: SupabaseClient | null = null;

export function getDb(): SupabaseClient {
  if (!client) {
    const url = (process.env.SUPABASE_URL ?? "").trim();
    const key = (process.env.SUPABASE_KEY ?? "").trim();
    if (!url || !key) {
      throw new Error("SUPABASE_URL and SUPABASE_KEY must be set (see .env.example).");
    }
    client = createClient(url, key, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
  }
  return client;
}

interface PgError {
  message: string;
  code?: string;
  details?: string;
}

function check(error: PgError | null, context: string): void {
  if (!error) return;
  if (error.code === "23505" || /duplicate key/i.test(error.message)) {
    throw new DuplicateKeyError(error.message);
  }
  throw new DatabaseError(`${context}: ${error.message}`, error.code);
}

/** Apply equality filters. null -> IS NULL, array -> IN (...). */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function applyWhere(query: any, where?: Where): any {
  for (const [column, value] of Object.entries(where ?? {})) {
    if (value === null) query = query.is(column, null);
    else if (Array.isArray(value)) query = query.in(column, value);
    else query = query.eq(column, value);
  }
  return query;
}

export interface FetchOptions {
  where?: Where;
  columns?: string;
  order?: Order;
  limit?: number;
  /** Optional function(query) -> query for range / ilike filters. */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  extra?: (query: any) => any;
}

/** Return a list of rows. Pages through results automatically, so >1000 rows still works. */
export async function fetchRows(table: string, opts: FetchOptions = {}): Promise<Row[]> {
  const db = getDb();
  const rows: Row[] = [];
  let start = 0;
  for (;;) {
    let stop = start + PAGE - 1;
    if (opts.limit !== undefined) stop = Math.min(stop, opts.limit - 1);
    let query = applyWhere(db.from(table).select(opts.columns ?? "*"), opts.where);
    if (opts.extra) query = opts.extra(query);
    for (const [column, descending] of opts.order ?? []) {
      query = query.order(column, { ascending: !descending });
    }
    const { data, error } = await query.range(start, stop);
    check(error, `select ${table}`);
    const batch: Row[] = data ?? [];
    rows.push(...batch);
    if (batch.length < stop - start + 1 || (opts.limit !== undefined && rows.length >= opts.limit)) break;
    start = stop + 1;
  }
  return rows;
}

/** Return the first matching row, or null. */
export async function getOne(table: string, where: Where, columns = "*"): Promise<Row | null> {
  const { data, error } = await applyWhere(getDb().from(table).select(columns), where).limit(1);
  check(error, `select ${table}`);
  return (data as Row[] | null)?.[0] ?? null;
}

export async function countRows(table: string, where?: Where): Promise<number> {
  const { count, error } = await applyWhere(
    getDb().from(table).select("id", { count: "exact", head: true }),
    where,
  );
  check(error, `count ${table}`);
  return count ?? 0;
}

/** Insert one row (returns the stored row). */
export async function insertRow(table: string, data: Row): Promise<Row> {
  const { data: rows, error } = await getDb().from(table).insert(data).select();
  check(error, `insert ${table}`);
  return (rows as Row[] | null)?.[0] ?? {};
}

/** Insert many rows (returns the stored rows). */
export async function insertRows(table: string, data: Row[]): Promise<Row[]> {
  const { data: rows, error } = await getDb().from(table).insert(data).select();
  check(error, `insert ${table}`);
  return (rows as Row[] | null) ?? [];
}

export async function updateRows(table: string, where: Where, values: Row): Promise<Row[]> {
  if (!Object.keys(where).length) throw new Error("updateRows() needs a where clause");
  const { data, error } = await applyWhere(getDb().from(table).update(values), where).select();
  check(error, `update ${table}`);
  return (data as Row[] | null) ?? [];
}

export async function deleteRows(table: string, where: Where): Promise<Row[]> {
  if (!Object.keys(where).length) throw new Error("deleteRows() needs a where clause");
  const { data, error } = await applyWhere(getDb().from(table).delete(), where).select();
  check(error, `delete ${table}`);
  return (data as Row[] | null) ?? [];
}

export async function upsertRow(table: string, data: Row, onConflict: string): Promise<Row[]> {
  const { data: rows, error } = await getDb().from(table).upsert(data, { onConflict }).select();
  check(error, `upsert ${table}`);
  return (rows as Row[] | null) ?? [];
}
