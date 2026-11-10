import 'dotenv/config';
import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../generated/prisma/client.js';

/**
 * Database connection pool.
 * The database can be far away (another region / Supabase): opening a connection then costs several round trips
 * (TCP + TLS + login). So connections are KEPT OPEN and re-used instead of being closed after 10 s of quiet
 * (node-postgres' default), TCP keep-alive stops routers from dropping them, and the pool is warmed at start-up.
 *   DB_POOL_MAX   connections at most (default 10 — Supabase's pooler allows plenty; keep ≤ 15 on the free plan)
 */
function poolUrl(raw: string) {
  // "pgbouncer" and "connection_limit" are for Prisma's old engine; node-postgres does not use them
  try {
    const u = new URL(raw);
    u.searchParams.delete('pgbouncer');
    u.searchParams.delete('connection_limit');
    return u.toString();
  } catch {
    return raw;
  }
}

@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  private readonly log = new Logger('Database');

  constructor() {
    const adapter = new PrismaPg({
      connectionString: poolUrl(process.env.DATABASE_URL!),
      max: Math.max(2, Number(process.env.DB_POOL_MAX) || 10),
      idleTimeoutMillis: 10 * 60_000, // keep idle connections 10 minutes (default 10 s → a new TLS login on most requests)
      connectionTimeoutMillis: 15_000,
      keepAlive: true,
      keepAliveInitialDelayMillis: 30_000,
    });
    super({ adapter });
  }

  async onModuleInit() {
    // open a few connections now, so the first visitors do not pay for the logins
    const t0 = Date.now();
    try {
      await Promise.all(Array.from({ length: 3 }, () => this.$queryRawUnsafe('SELECT 1')));
      const t1 = Date.now();
      await this.$queryRawUnsafe('SELECT 1');
      this.log.log(`Connected (warm-up ${t1 - t0} ms). One query round trip to the database: ${Date.now() - t1} ms`);
    } catch (e) {
      this.log.warn(`Warm-up failed: ${(e as Error).message}`);
    }
  }

  async onModuleDestroy() {
    await this.$disconnect();
  }
}
