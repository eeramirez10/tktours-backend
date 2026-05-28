import type { InquiryRepository } from '../../domain/repositories/inquiry.repository.js';

export class GetInquiryByIdUseCase {
  constructor(private readonly inquiryRepository: InquiryRepository) {}

  execute(inquiryId: string) {
    return this.inquiryRepository.findById(inquiryId);
  }
}
