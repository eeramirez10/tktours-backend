import { SignJWT, jwtVerify } from 'jose';

import { env } from '../../../../shared/config/env.js';
import { UnauthorizedAppError } from '../../../../shared/domain/errors/app-error.js';
import type { AuthenticatedAdmin } from '../../domain/auth.types.js';

const encoder = new TextEncoder();

function getSigningKey(): Uint8Array {
  return encoder.encode(env.ADMIN_JWT_SECRET);
}

export async function createAdminAccessToken(admin: AuthenticatedAdmin): Promise<string> {
  return new SignJWT({ email: admin.email, name: admin.name, role: admin.role })
    .setProtectedHeader({ alg: 'HS256' })
    .setSubject(admin.id)
    .setIssuedAt()
    .setExpirationTime(env.ADMIN_AUTH_TOKEN_TTL)
    .sign(getSigningKey());
}

export async function readAdminAccessToken(token: string): Promise<{ adminId: string }> {
  try {
    const { payload } = await jwtVerify(token, getSigningKey(), { algorithms: ['HS256'] });
    if (!payload.sub) {
      throw new UnauthorizedAppError('Invalid access token');
    }

    return { adminId: payload.sub };
  } catch (error) {
    if (error instanceof UnauthorizedAppError) {
      throw error;
    }

    throw new UnauthorizedAppError('Invalid or expired access token');
  }
}
