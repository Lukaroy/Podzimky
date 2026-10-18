import { PrismaNeon } from "@prisma/adapter-neon";
import { PrismaClient } from "@prisma/client";

const globalForPrisma = globalThis as typeof globalThis & {
  prisma?: PrismaClient;
};

let prismaClient: PrismaClient | undefined = globalForPrisma.prisma;

// Vytvoří Prisma klienta připojeného k PostgreSQL přes Neon adaptér.
function createPrismaClient() {
  const connectionString = process.env.DATABASE_URL?.trim();
  if (!connectionString) throw new Error("DATABASE_URL is required to connect to PostgreSQL.");
  const adapter = new PrismaNeon({ connectionString });
  return new PrismaClient({ adapter });
}

// Vrátí sdílenou instanci Prisma klienta pro databázové operace.
export function getPrisma() {
  prismaClient ??= createPrismaClient();
  // V dev režimu reuse instance přežije obnovování modulů Next.js.
  if (process.env.NODE_ENV !== "production") globalForPrisma.prisma = prismaClient;
  return prismaClient;
}
