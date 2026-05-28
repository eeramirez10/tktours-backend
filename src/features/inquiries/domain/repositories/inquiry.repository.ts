import type {
  CreateInquiryInput,
  InquiryDetail,
  InquiryListItem,
  ListInquiriesQuery,
  UpdateInquiryInput,
  UpdateInquiryStatusInput,
} from '../types/inquiry.types.js';

export interface InquiryRepository {
  findMany(query: ListInquiriesQuery): Promise<InquiryListItem[]>;
  findById(inquiryId: string): Promise<InquiryDetail | null>;
  create(input: CreateInquiryInput): Promise<InquiryDetail>;
  update(input: UpdateInquiryInput): Promise<InquiryDetail>;
  updateStatus(input: UpdateInquiryStatusInput): Promise<InquiryDetail>;
  replaceRecommendations(inquiryId: string, recommendations: Array<{ programId: string; reason: string | null; confidence: number | null }>): Promise<InquiryDetail>;
}
