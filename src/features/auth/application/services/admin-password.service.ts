import argon2 from 'argon2';

const passwordHashOptions = {
  type: 2 as const,
  memoryCost: 19_456,
  timeCost: 2,
  parallelism: 1,
};

export function hashAdminPassword(password: string): Promise<string> {
  return argon2.hash(password, passwordHashOptions);
}

export function verifyAdminPassword(passwordHash: string, password: string): Promise<boolean> {
  return argon2.verify(passwordHash, password);
}
