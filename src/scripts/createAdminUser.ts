import dotenv from 'dotenv';

const envFile = process.env.NODE_ENV === 'production' ? '.env' : '.env.development';
dotenv.config({ path: envFile });

function readOption(name: string): string | undefined {
  const optionIndex = process.argv.indexOf(`--${name}`);
  return optionIndex >= 0 ? process.argv[optionIndex + 1]?.trim() : undefined;
}

const email = (readOption('email') ?? process.env.ADMIN_EMAIL)?.trim().toLowerCase();
const name = (readOption('name') ?? process.env.ADMIN_NAME)?.trim();
const password = process.env.ADMIN_PASSWORD;
const role = (readOption('role') ?? process.env.ADMIN_ROLE ?? 'ADMIN').trim().toUpperCase();

if (!email || !name || !password) {
  throw new Error(
    'Required values: ADMIN_PASSWORD and --email/--name (or ADMIN_EMAIL and ADMIN_NAME).',
  );
}

if (password.length < 12) {
  throw new Error('ADMIN_PASSWORD must have at least 12 characters.');
}

if (role !== 'ADMIN' && role !== 'OPERATOR') {
  throw new Error('Role must be ADMIN or OPERATOR.');
}

const [{ hashAdminPassword }, { prisma }] = await Promise.all([
  import('../features/auth/application/services/admin-password.service.js'),
  import('../shared/infrastructure/database/prisma.js'),
]);

try {
  const passwordHash = await hashAdminPassword(password);
  const admin = await prisma.adminUser.upsert({
    where: { email },
    create: { email, name, passwordHash, role, active: true },
    update: { name, passwordHash, role, active: true },
    select: { id: true, email: true, name: true, role: true, active: true },
  });

  console.log(`Admin user ready: ${admin.email} (${admin.role})`);
} finally {
  await prisma.$disconnect();
}
