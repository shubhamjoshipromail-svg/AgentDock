import { prisma } from "../../lib/prisma";
import { CURATED_SERVER_REGISTRATIONS } from "../../lib/registry/server-registrations";

export { prisma };

export async function resetDatabase() {
  const tables = await prisma.$queryRaw<{ tablename: string }[]>`
    SELECT tablename FROM pg_tables
    WHERE schemaname = 'public' AND tablename <> '_prisma_migrations'
  `;

  if (tables.length === 0) {
    return;
  }

  const tableList = tables.map((table) => `"public"."${table.tablename}"`).join(", ");
  await prisma.$executeRawUnsafe(`TRUNCATE TABLE ${tableList} RESTART IDENTITY CASCADE`);

  for (const reg of CURATED_SERVER_REGISTRATIONS) {
    await prisma.serverRegistration.create({
      data: {
        serverKey: reg.serverKey,
        displayName: reg.displayName,
        transport: reg.transport,
        command: reg.command ?? null,
        args: reg.args ?? undefined,
        url: reg.url ?? null,
        credentialProvider: reg.credentialProvider ?? null,
        tokenEnvVar: reg.tokenEnvVar ?? null,
        envAllowlist: reg.envAllowlist ?? [],
        enabled: true,
        curated: true
      }
    });
  }
}

export async function createTestUser(email = "test-user@example.com", name = "Test User") {
  return prisma.user.create({
    data: { email, name }
  });
}
