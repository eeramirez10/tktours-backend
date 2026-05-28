import type { InquiryRepository } from '../../domain/repositories/inquiry.repository.js';
import type { CreateInquiryInput } from '../../domain/types/inquiry.types.js';

export class CreateInquiryUseCase {
  constructor(private readonly inquiryRepository: InquiryRepository) {}

  execute(input: CreateInquiryInput) {
    return this.inquiryRepository.create(input);
  }
}
