import { PrismaClient } from '@prisma/client';

/** One client (and one connection pool) for the whole process. */
export const prisma = new PrismaClient();
