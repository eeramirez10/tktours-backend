import { CatalogRepository } from '../../../catalog/infrastructure/repositories/catalog.repository.js';
import type { InquiryRepository } from '../../domain/repositories/inquiry.repository.js';

export class RefreshInquiryRecommendationsUseCase {
  constructor(
    private readonly inquiryRepository: InquiryRepository,
    private readonly catalogRepository = new CatalogRepository(),
  ) {}

  async execute(inquiryId: string) {
    const inquiry = await this.inquiryRepository.findById(inquiryId);

    if (!inquiry) {
      return null;
    }

    if (!inquiry.country?.code) {
      return this.inquiryRepository.replaceRecommendations(inquiryId, []);
    }

    const recommendations = await this.catalogRepository.findRecommendedPrograms({
      countryCode: inquiry.country.code,
      familyKey: (inquiry.family?.key as 'CAMP' | 'LANGUAGE_COURSE' | 'SCHOOL_PROGRAM' | undefined) ?? undefined,
      studentAge: inquiry.studentAge ?? undefined,
      accommodationKey:
        (inquiry.accommodationType?.key as 'HOST_FAMILY' | 'UNIVERSITY_RESIDENCE' | 'SHARED_APARTMENT' | undefined) ?? undefined,
      preferredStartMonth: inquiry.preferredStartMonth ?? undefined,
      weeks: inquiry.weeks ?? undefined,
    });

    return this.inquiryRepository.replaceRecommendations(
      inquiryId,
      recommendations.slice(0, 10).map((item, index) => ({
        programId: item.id,
        reason: item.matchReasons.join('; '),
        confidence: Math.max(0.4, 1 - index * 0.08),
      })),
    );
  }
}
