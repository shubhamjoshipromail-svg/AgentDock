require("dotenv/config");

const { PrismaClient } = require("@prisma/client");
const { PrismaPg } = require("@prisma/adapter-pg");
const { ensureVettedFlowsForUser } = require("../lib/catalog/vetted-flows");

const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  throw new Error("DATABASE_URL is required to backfill vetted flows.");
}

const acceptsInvalidCerts = connectionString.includes("sslaccept=accept_invalid_certs");
const adapterConnectionString = acceptsInvalidCerts
  ? connectionString.replace(/[?&]sslmode=require/g, "").replace(/[?&]sslaccept=accept_invalid_certs/g, "")
  : connectionString;
const prisma = new PrismaClient({
  adapter: new PrismaPg({
    connectionString: adapterConnectionString,
    ssl: acceptsInvalidCerts ? { rejectUnauthorized: false } : undefined
  })
});

async function main() {
  const users = await prisma.user.findMany({ select: { id: true } });
  for (const user of users) {
    await ensureVettedFlowsForUser(prisma, user.id);
  }
  console.log(`Backfilled vetted flows for ${users.length} user(s).`);
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
