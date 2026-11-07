import 'dotenv/config';
import { PrismaClient } from '../src/generated/prisma/client.js';
import { PrismaPg } from '@prisma/adapter-pg';

/**
 * Script to promote a user to Platform Owner (SUPER_ADMIN / PLATFORM_ADMIN)
 * Usage:
 *   npx tsx scripts/promote-to-owner.ts <email-or-login> [password]
 */
async function main() {
  const targetLogin = (process.argv[2] || '').trim().toLowerCase();
  const explicitPassword = process.argv[3];

  if (!targetLogin) {
    console.error('Usage: npx tsx scripts/promote-to-owner.ts <email-or-login> [optional-new-password]');
    process.exit(1);
  }

  const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL });
  const prisma = new PrismaClient({ adapter });

  try {
    console.log(`Checking account: ${targetLogin}...`);

    // 1. Check if already a PlatformOwner
    const existingOwner = await prisma.platformOwner.findUnique({
      where: { login: targetLogin },
    });

    if (existingOwner) {
      console.log(`Account is already a PlatformOwner (ID: ${existingOwner.id}, disabled: ${existingOwner.disabled})`);
      if (existingOwner.disabled) {
        await prisma.platformOwner.update({
          where: { id: existingOwner.id },
          data: { disabled: false },
        });
        console.log(`Re-enabled disabled PlatformOwner: ${targetLogin}`);
      }
      return;
    }

    // 2. Check if user exists in DealerUser
    const dealerUser = await prisma.dealerUser.findFirst({
      where: {
        OR: [
          { login: targetLogin },
          { email: targetLogin },
        ],
      },
    });

    if (dealerUser) {
      console.log(`Found DealerUser: ${dealerUser.login} (ID: ${dealerUser.id}, Current Dealer Role: ${dealerUser.role})`);
      
      const newOwner = await prisma.platformOwner.create({
        data: {
          login: targetLogin,
          name: dealerUser.name || targetLogin,
          email: dealerUser.email || targetLogin,
          passwordHash: dealerUser.passwordHash,
          disabled: false,
        },
      });

      console.log(`Successfully promoted "${targetLogin}" to PlatformOwner!`);
      console.log(`PlatformOwner ID: ${newOwner.id}`);
      console.log(`User can now log into the Platform Admin Portal with their existing credentials.`);
      return;
    }

    // 3. User does not exist in DealerUser either
    console.log(`No existing DealerUser found for "${targetLogin}".`);
    if (explicitPassword) {
      const { hashPassword } = await import('../src/tenants/tenants.service.js');
      const hash = await hashPassword(explicitPassword);
      const newOwner = await prisma.platformOwner.create({
        data: {
          login: targetLogin,
          name: targetLogin,
          email: targetLogin,
          passwordHash: hash,
          disabled: false,
        },
      });
      console.log(`Created new PlatformOwner "${targetLogin}" with provided password.`);
      console.log(`PlatformOwner ID: ${newOwner.id}`);
    } else {
      console.error(`Cannot create PlatformOwner without password. Please provide a password as the 2nd argument:`);
      console.error(`  npx tsx scripts/promote-to-owner.ts ${targetLogin} <password>`);
    }
  } finally {
    await prisma['$disconnect']();
  }
}

main().catch((e) => {
  console.error('Promotion error:', e);
  process.exit(1);
});
