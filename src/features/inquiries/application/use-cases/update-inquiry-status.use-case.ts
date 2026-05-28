import type { InquiryRepository } from '../../domain/repositories/inquiry.repository.js';
import type { UpdateInquiryStatusInput } from '../../domain/types/inquiry.types.js';

export class UpdateInquiryStatusUseCase {
  constructor(private readonly inquiryRepository: InquiryRepository) {}

  execute(input: UpdateInquiryStatusInput) {
    return this.inquiryRepository.updateStatus(input);
  }
}
