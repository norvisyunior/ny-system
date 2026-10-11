import type { NodeSqliteDatabase, NodeSqliteRunResult } from "../db/node-sqlite";
import type { ExtractTablesWithRelations } from "drizzle-orm/relations";
import type { SQLiteTransaction } from "drizzle-orm/sqlite-core";

export type DB = NodeSqliteDatabase;

/** Entorno transaccional: la base o un tx dentro de db.transaction(). */
export type Tx = SQLiteTransaction<
  "sync",
  NodeSqliteRunResult,
  Record<string, never>,
  ExtractTablesWithRelations<Record<string, never>>
>;

/** Acepta tanto la base de datos como un entorno transaccional. */
export type DBOrTx = DB | Tx;

export type { NodeSqliteRunResult };
