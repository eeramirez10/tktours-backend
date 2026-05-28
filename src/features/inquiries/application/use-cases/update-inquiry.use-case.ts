import type { InquiryRepository } from '../../domain/repositories/inquiry.repository.js';
import type { UpdateInquiryInput } from '../../domain/types/inquiry.types.js';

export class UpdateInquiryUseCase {
  constructor(private readonly inquiryRepository: InquiryRepository) {}

  execute(input: UpdateInquiryInput) {
    return this.inquiryRepository.update(input);
  }
}
