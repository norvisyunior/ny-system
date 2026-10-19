import { DatabaseSync, type StatementSync } from "node:sqlite";
import {
  entityKind,
  fillPlaceholders,
  mapResultRow,
  sql,
  NoopLogger,
  type Logger,
  type Query,
} from "drizzle-orm";
import { NoopCache, type Cache } from "drizzle-orm/cache/core";
import { BaseSQLiteDatabase, SQLiteSyncDialect } from "drizzle-orm/sqlite-core";
import {
  SQLitePreparedQuery,
  SQLiteSession,
  SQLiteTransaction,
  type PreparedQueryConfig as BasePreparedQueryConfig,
  type SQLiteExecuteMethod,
  type SQLiteTransactionConfig,
} from "drizzle-orm/sqlite-core/session";
import type { SelectedFieldsOrdered } from "drizzle-orm/sqlite-core/query-builders/select.types";
import type {
  ExtractTablesWithRelations,
  RelationalSchemaConfig,
  TablesRelationalConfig,
} from "drizzle-orm/relations";
import type { DrizzleConfig } from "drizzle-orm/utils";

// Shim de tipos: drizzle-orm exporta mapResultRow en runtime pero sin .d.ts.
declare module "drizzle-orm" {
  export function mapResultRow(
    fields: SelectedFieldsOrdered,
    row: unknown[],
    joinsNotNullableMap: Record<string, boolean> | undefined,
  ): unknown;
}

export interface NodeSqliteRunResult {
  changes: number;
  lastInsertRowid: number | bigint;
}

/**
 * node:sqlite lanza ERR_OUT_OF_RANGE al leer INTEGERs fuera del rango seguro
 * de Number (p. ej. SUM(qty_micro * cost_micro) en escala micro²). Se leen
 * como BigInt y se normalizan aquí a number; la pérdida de precisión a esa
 * escala es despreciable (±unidades de micro² tras dividir por 1e6).
 */
function toJsValue(v: unknown): unknown {
  return typeof v === "bigint" ? Number(v) : v;
}

function normalizeRow<T>(row: T): T {
  if (Array.isArray(row)) return row.map(toJsValue) as unknown as T;
  if (row && typeof row === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(row as Record<string, unknown>)) {
      out[k] = toJsValue(v);
    }
    return out as T;
  }
  return row;
}

export interface NodeSqliteSessionOptions {
  logger?: Logger;
  cache?: Cache;
}

type PreparedQueryConfig = Omit<BasePreparedQueryConfig, "statement" | "run">;

export class NodeSqliteSession<
  TFullSchema extends Record<string, unknown> = Record<string, never>,
  TSchema extends TablesRelationalConfig = ExtractTablesWithRelations<TFullSchema>,
> extends SQLiteSession<"sync", NodeSqliteRunResult, TFullSchema, TSchema> {
  static [entityKind] = "NodeSqliteSession";

  readonly dialect: SQLiteSyncDialect;
  private readonly logger: Logger;
  private readonly cache: Cache;

  constructor(
    private readonly client: DatabaseSync,
    dialect: SQLiteSyncDialect,
    private readonly schema: RelationalSchemaConfig<TSchema> | undefined,
    options: NodeSqliteSessionOptions = {},
  ) {
    super(dialect);
    this.dialect = dialect;
    this.logger = options.logger ?? new NoopLogger();
    this.cache = options.cache ?? new NoopCache();
  }

  prepareQuery<T extends Omit<PreparedQueryConfig, "run">>(
    query: Query,
    fields: SelectedFieldsOrdered | undefined,
    executeMethod: SQLiteExecuteMethod,
    isResponseInArrayMode: boolean,
    customResultMapper?: (rows: unknown[][]) => unknown,
    queryMetadata?: {
      type: "select" | "update" | "delete" | "insert";
      tables: string[];
    },
    cacheConfig?: unknown,
  ): PreparedQuery<T> {
    const stmt = this.client.prepare(query.sql);
    stmt.setReadBigInts(true);
    return new PreparedQuery(
      stmt,
      query,
      this.logger,
      this.cache,
      queryMetadata,
      cacheConfig,
      fields,
      executeMethod,
      isResponseInArrayMode,
      customResultMapper,
    );
  }

  transaction<T>(
    transaction: (tx: NodeSqliteTransaction<TFullSchema, TSchema>) => T,
    config: SQLiteTransactionConfig = {},
  ): T {
    const tx = new NodeSqliteTransaction<TFullSchema, TSchema>(
      "sync",
      this.dialect,
      this,
      this.schema,
    );
    const behavior = (config.behavior ?? "deferred").toUpperCase();
    this.client.exec(`BEGIN ${behavior}`);
    try {
      const result = transaction(tx);
      this.client.exec("COMMIT");
      return result;
    } catch (error) {
      try {
        this.client.exec("ROLLBACK");
      } catch {
        // se conserva el error original
      }
      throw error;
    }
  }
}

export class NodeSqliteTransaction<
  TFullSchema extends Record<string, unknown> = Record<string, never>,
  TSchema extends TablesRelationalConfig = ExtractTablesWithRelations<TFullSchema>,
> extends SQLiteTransaction<"sync", NodeSqliteRunResult, TFullSchema, TSchema> {
  static [entityKind] = "NodeSqliteTransaction";

  private readonly txSession: SQLiteSession<
    "sync",
    NodeSqliteRunResult,
    TFullSchema,
    TSchema
  >;
  private readonly txDialect: SQLiteSyncDialect;

  constructor(
    resultType: "sync",
    dialect: SQLiteSyncDialect,
    session: SQLiteSession<"sync", NodeSqliteRunResult, TFullSchema, TSchema>,
    schema: RelationalSchemaConfig<TSchema> | undefined,
    nestedIndex?: number,
  ) {
    super(resultType, dialect, session, schema, nestedIndex);
    this.txSession = session;
    this.txDialect = dialect;
  }

  transaction<T>(
    transaction: (tx: NodeSqliteTransaction<TFullSchema, TSchema>) => T,
  ): T {
    const savepointName = `sp${this.nestedIndex}`;
    const tx = new NodeSqliteTransaction<TFullSchema, TSchema>(
      "sync",
      this.txDialect,
      this.txSession,
      this.schema,
      this.nestedIndex + 1,
    );
    this.txSession.run(sql.raw(`savepoint ${savepointName}`));
    try {
      const result = transaction(tx);
      this.txSession.run(sql.raw(`release savepoint ${savepointName}`));
      return result;
    } catch (error) {
      this.txSession.run(sql.raw(`rollback to savepoint ${savepointName}`));
      throw error;
    }
  }
}

export class PreparedQuery<
  T extends PreparedQueryConfig = PreparedQueryConfig,
> extends SQLitePreparedQuery<{
  type: "sync";
  run: NodeSqliteRunResult;
  all: T["all"];
  get: T["get"];
  values: T["values"];
  execute: T["execute"];
}> {
  static [entityKind] = "NodeSqlitePreparedQuery";

  declare joinsNotNullableMap: Record<string, boolean>;

  constructor(
    private readonly stmt: StatementSync,
    query: Query,
    private readonly logger: Logger,
    cache: Cache,
    queryMetadata:
      | {
          type: "select" | "update" | "delete" | "insert";
          tables: string[];
        }
      | undefined,
    cacheConfig: unknown,
    private readonly fields: SelectedFieldsOrdered | undefined,
    executeMethod: SQLiteExecuteMethod,
    private readonly _isResponseInArrayMode: boolean,
    private readonly customResultMapper?: (rows: unknown[][]) => unknown,
  ) {
    super(
      "sync",
      executeMethod,
      query,
      cache,
      queryMetadata,
      cacheConfig as never,
    );
  }

  run(placeholderValues?: Record<string, unknown>): NodeSqliteRunResult {
    const params = fillPlaceholders(this.query.params, placeholderValues ?? {});
    this.logger.logQuery(this.query.sql, params);
    const result = this.stmt.run(...(params as never[])) as NodeSqliteRunResult;
    return {
      changes: Number(result.changes),
      lastInsertRowid:
        typeof result.lastInsertRowid === "bigint" ? Number(result.lastInsertRowid) : result.lastInsertRowid,
    };
  }

  all(placeholderValues?: Record<string, unknown>): T["all"] {
    const { fields, joinsNotNullableMap, query, logger, stmt, customResultMapper } =
      this;
    if (!fields && !customResultMapper) {
      const params = fillPlaceholders(query.params, placeholderValues ?? {});
      logger.logQuery(query.sql, params);
      const rows = stmt.all(...(params as never[])) as unknown[];
      return rows.map((row) => normalizeRow(row)) as T["all"];
    }
    const rows = this.values(placeholderValues);
    if (customResultMapper) {
      return customResultMapper(rows) as T["all"];
    }
    return rows.map((row) =>
      mapResultRow(fields!, row, joinsNotNullableMap),
    ) as T["all"];
  }

  get(placeholderValues?: Record<string, unknown>): T["get"] {
    const params = fillPlaceholders(this.query.params, placeholderValues ?? {});
    this.logger.logQuery(this.query.sql, params);
    const { fields, stmt, joinsNotNullableMap, customResultMapper } = this;
    if (!fields && !customResultMapper) {
      const row = stmt.get(...(params as never[]));
      return (row === undefined ? undefined : normalizeRow(row)) as T["get"];
    }
    const row = this.getRowArray(params);
    if (row === undefined) {
      return undefined as T["get"];
    }
    if (customResultMapper) {
      return customResultMapper([row]) as T["get"];
    }
    return mapResultRow(fields!, row, joinsNotNullableMap) as T["get"];
  }

  values(placeholderValues?: Record<string, unknown>): unknown[][] {
    const params = fillPlaceholders(this.query.params, placeholderValues ?? {});
    this.logger.logQuery(this.query.sql, params);
    return this.getRowsArrays(params);
  }

  /** @internal */
  isResponseInArrayMode(): boolean {
    return this._isResponseInArrayMode;
  }

  private getRowArray(params: unknown[]): unknown[] | undefined {
    this.stmt.setReturnArrays(true);
    try {
      const row = this.stmt.get(...(params as never[]));
      if (row === undefined) return undefined;
      return (row as unknown[]).map(toJsValue);
    } finally {
      this.stmt.setReturnArrays(false);
    }
  }

  private getRowsArrays(params: unknown[]): unknown[][] {
    this.stmt.setReturnArrays(true);
    try {
      const rows = this.stmt.all(...(params as never[])) as unknown[][];
      return rows.map((row) => row.map(toJsValue));
    } finally {
      this.stmt.setReturnArrays(false);
    }
  }
}

export class NodeSqliteDatabase<
  TSchema extends Record<string, unknown> = Record<string, never>,
> extends BaseSQLiteDatabase<"sync", NodeSqliteRunResult, TSchema> {
  static [entityKind] = "NodeSqliteDatabase";
  declare $client: DatabaseSync;
}

function construct(
  client: DatabaseSync,
  config: DrizzleConfig<Record<string, never>> = {},
): NodeSqliteDatabase {
  const dialect = new SQLiteSyncDialect({ casing: config.casing });
  let logger: Logger | undefined;
  if (config.logger === true) {
    logger = new NoopLogger();
  } else if (config.logger !== false) {
    logger = config.logger;
  }
  const session = new NodeSqliteSession(client, dialect, undefined, { logger });
  const db = new NodeSqliteDatabase("sync", dialect, session, undefined);
  db.$client = client;
  return db;
}

export function drizzle(
  params: string | DatabaseSync,
  config?: DrizzleConfig<Record<string, never>>,
): NodeSqliteDatabase {
  if (typeof params === "string") {
    return construct(new DatabaseSync(params), config);
  }
  return construct(params, config);
}
