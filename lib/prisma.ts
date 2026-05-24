import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@prisma/client";

const connectionString =
  process.env.DATABASE_URL ?? "postgresql://agentdock:agentdock@localhost:5432/agentdock?schema=public";
const acceptsInvalidCerts = connectionString.includes("sslaccept=accept_invalid_certs");
const adapterConnectionString = acceptsInvalidCerts
  ? connectionString.replace(/[?&]sslmode=require/g, "").replace(/[?&]sslaccept=accept_invalid_certs/g, "")
  : connectionString;

const globalForPrisma = globalThis as unknown as {
  prisma?: PrismaClient;
};

const adapter = new PrismaPg({
  connectionString: adapterConnectionString,
  ssl: acceptsInvalidCerts ? { rejectUnauthorized: false } : undefined
});

export const prisma = globalForPrisma.prisma ?? new PrismaClient({ adapter });

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.prisma = prisma;
}
