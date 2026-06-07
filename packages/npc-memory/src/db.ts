import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema.js";

function newDb(client: postgres.Sql) {
  return drizzle(client, { schema });
}

export type Db = ReturnType<typeof newDb>;

let sharedClient: postgres.Sql | null = null;
let sharedDb: Db | null = null;

/** One postgres.js pool for memory + collective (avoids Supabase session pool exhaustion). */
export function getSharedDb(databaseUrl: string): Db {
  if (sharedDb) return sharedDb;
  sharedClient = postgres(databaseUrl, {
    max: 3,
    idle_timeout: 30,
    connect_timeout: 10,
    prepare: false,
  });
  sharedDb = newDb(sharedClient);
  return sharedDb;
}

/** Raw SQL client sharing the same pool as {@link getSharedDb}. */
export function getSharedSql(databaseUrl: string): postgres.Sql {
  getSharedDb(databaseUrl);
  if (!sharedClient) {
    throw new Error("shared postgres client failed to initialize");
  }
  return sharedClient;
}

export function createDb(databaseUrl: string): Db {
  return getSharedDb(databaseUrl);
}

/** @internal vitest */
export async function resetSharedDbForTests(): Promise<void> {
  if (sharedClient) {
    await sharedClient.end({ timeout: 0 });
  }
  sharedClient = null;
  sharedDb = null;
}
