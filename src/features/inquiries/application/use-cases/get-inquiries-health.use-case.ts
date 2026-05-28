import type { InquiriesHealth } from '../../domain/types/inquiry.types.js';

export class GetInquiriesHealthUseCase {
  execute(): InquiriesHealth {
    return { feature: 'inquiries', ready: true };
  }
}
