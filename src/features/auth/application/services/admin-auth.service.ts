import { prisma } from '../../../../shared/infrastructure/database/prisma.js';
import { UnauthorizedAppError } from '../../../../shared/domain/errors/app-error.js';
import type { AdminLoginResult, AuthenticatedAdmin } from '../../domain/auth.types.js';
import { verifyAdminPassword } from './admin-password.service.js';
import { createAdminAccessToken, readAdminAccessToken } from './admin-token.service.js';

const adminSelect = {
  id: true,
  email: true,
  name: true,
  role: true,
  active: true,
  passwordHash: true,
} as const;

function toAuthenticatedAdmin(admin: { id: string; email: string; name: string; role: string }): AuthenticatedAdmin {
  return {
    id: admin.id,
    email: admin.email,
    name: admin.name,
    role: admin.role,
  };
}

export class AdminAuthService {
  async login(email: string, password: string): Promise<AdminLoginResult> {
    const normalizedEmail = email.trim().toLowerCase();
    const admin = await prisma.adminUser.findUnique({
      where: { email: normalizedEmail },
      select: adminSelect,
    });

    if (!admin || !admin.active || !(await verifyAdminPassword(admin.passwordHash, password))) {
      throw new UnauthorizedAppError('Invalid email or password');
    }

    const authenticatedAdmin = toAuthenticatedAdmin(admin);
    const accessToken = await createAdminAccessToken(authenticatedAdmin);

    await prisma.adminUser.update({
      where: { id: admin.id },
      data: { lastLoginAt: new Date() },
    });

    return { accessToken, admin: authenticatedAdmin };
  }

  async getAuthenticatedAdmin(accessToken: string): Promise<AuthenticatedAdmin> {
    const { adminId } = await readAdminAccessToken(accessToken);
    const admin = await prisma.adminUser.findUnique({
      where: { id: adminId },
      select: {
        id: true,
        email: true,
        name: true,
        role: true,
        active: true,
      },
    });

    if (!admin || !admin.active) {
      throw new UnauthorizedAppError('This account is no longer active');
    }

    return toAuthenticatedAdmin(admin);
  }
}
