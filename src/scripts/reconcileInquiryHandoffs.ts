import dotenv from 'dotenv';
dotenv.config({ path: process.env.NODE_ENV === 'production' ? '.env' : '.env.development', quiet: true });
const { prisma } = await import('../shared/infrastructure/database/prisma.js');
const { reconcileInquiryHandoffs } = await import('../features/inquiries/application/services/reconcile-inquiry-handoffs.service.js');
try {
  const args = process.argv.slice(2);
  if (args.some((arg) => arg !== '--apply')) throw new Error('Usage: pnpm inquiries:reconcile-handoffs [--apply]');
  console.log(JSON.stringify(await reconcileInquiryHandoffs(args.includes('--apply')), null, 2));
} catch (error) {
  console.error(error instanceof Error ? error.message : 'Reconciliation failed');
  process.exitCode = 1;
} finally {
  await prisma.$disconnect();
}
