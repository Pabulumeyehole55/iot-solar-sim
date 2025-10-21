import { PrismaClient } from '@prisma/client';
import { config } from '../config';

// Global Prisma client instance
let prisma: PrismaClient;

export function getPrismaClient(): PrismaClient {
  if (!prisma) {
    prisma = new PrismaClient({
      datasources: {
        db: {
          url: config.databaseUrl,
        },
      },
      log: config.logging.level === 'debug' ? ['query', 'info', 'warn', 'error'] : ['warn', 'error'],
    });
  }
  return prisma;
}

export async function connectDatabase(): Promise<void> {
  const client = getPrismaClient();
  try {
    await client.$connect();
    console.log('Database connected successfully');
  } catch (error) {
    console.error('Failed to connect to database:', error);
    throw error;
  }
}

export async function disconnectDatabase(): Promise<void> {
  const client = getPrismaClient();
  try {
    await client.$disconnect();
    console.log('Database disconnected successfully');
  } catch (error) {
    console.error('Failed to disconnect from database:', error);
    throw error;
  }
}

export async function healthCheck(): Promise<{ ok: boolean; error?: string }> {
  try {
    const client = getPrismaClient();
    await client.$queryRaw`SELECT 1`;
    return { ok: true };
  } catch (error) {
    return { 
      ok: false, 
      error: error instanceof Error ? error.message : 'Unknown database error' 
    };
  }
}
