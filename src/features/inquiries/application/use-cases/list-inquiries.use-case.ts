import type { InquiryRepository } from '../../domain/repositories/inquiry.repository.js';
import type { ListInquiriesQuery } from '../../domain/types/inquiry.types.js';

export class ListInquiriesUseCase {
  constructor(private readonly inquiryRepository: InquiryRepository) {}

  execute(query: ListInquiriesQuery) {
    return this.inquiryRepository.findMany(query);
  }
}
