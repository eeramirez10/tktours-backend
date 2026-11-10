import { env } from '../../../../shared/config/env.js';
import { AppError } from '../../../../shared/domain/errors/app-error.js';

export type WhatsAppAccount = { phoneNumber: string; displayName: string };

export class MetaWhatsAppAccountService {
  private cached: { value: WhatsAppAccount; expiresAt: number } | null = null;
  private pending: Promise<WhatsAppAccount> | null = null;

  constructor(private readonly request: typeof fetch = fetch) {}

  async getAccount(): Promise<WhatsAppAccount> {
    if (this.cached && this.cached.expiresAt > Date.now()) return this.cached.value;
    if (this.pending) return this.pending;
    this.pending = this.load().finally(() => { this.pending = null; });
    return this.pending;
  }

  private async load(): Promise<WhatsAppAccount> {
    try {
      const response = await this.request(`https://graph.facebook.com/${env.WHATSAPP_META_GRAPH_API_VERSION}/${env.WHATSAPP_META_PHONE_NUMBER_ID}?fields=display_phone_number,verified_name`, {
        headers: { Authorization: `Bearer ${env.WHATSAPP_META_ACCESS_TOKEN}` }, signal: AbortSignal.timeout(10_000),
      });
      if (!response.ok) throw new Error('Provider lookup failed');
      const result = await response.json() as Record<string, unknown>;
      const digits = typeof result.display_phone_number === 'string' ? result.display_phone_number.replace(/\D/g, '') : '';
      if (!/^\d{8,15}$/.test(digits)) throw new Error('Invalid account number');
      const value = { phoneNumber: `+${digits}`, displayName: typeof result.verified_name === 'string' ? result.verified_name : 'TKTours' };
      this.cached = { value, expiresAt: Date.now() + 300_000 };
      return value;
    } catch {
      throw new AppError('No se pudo consultar el número de WhatsApp configurado. Intenta nuevamente.', 503, 'WHATSAPP_ACCOUNT_UNAVAILABLE');
    }
  }
}
