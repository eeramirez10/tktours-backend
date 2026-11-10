import { resourceDocumentName } from '../../domain/resource-document-name.js';
import { resourceTripCompatibility } from '../../domain/resource-trip-compatibility.js';
import { prisma } from '../../../../shared/infrastructure/database/prisma.js';
import { resourceEligibilityFilters, resourceValidityStatus } from '../../domain/resource-validity.js';

type ValidatedDelivery = { urls: string[]; versions: Array<{ resourceId: string; versionId: string; url?: string; fileName?: string; resourceTitle?: string; mimeType?: string | null }> };

export class ResourceDeliveryGuardService {
  async filterMediaUrls(urls: string[], inquiryId: string | null): Promise<string[]> {
    return (await this.prepareDelivery(urls, inquiryId)).urls;
  }

  async prepareDelivery(urls: string[], inquiryId: string | null): Promise<ValidatedDelivery> {
    const parsedUrls = urls.flatMap((url) => {
      try {
        const parsed = new URL(url);
        return ['http:', 'https:'].includes(parsed.protocol) ? [{ url, pathname: parsed.pathname }] : [];
      } catch {
        return [];
      }
    });
    if (!parsedUrls.length) return { urls: [], versions: [] };
    const inquiry = inquiryId ? await prisma.inquiry.findUnique({
      where: { id: inquiryId },
      select: {
        studentAge: true, preferredStartMonth: true, preferredStartYear: true,
        countryId: true, familyId: true, programId: true, locationId: true,
      },
    }) : null;
    if (inquiryId && !inquiry) return { urls: [], versions: [] };
    const targetDate = inquiry?.preferredStartYear && inquiry.preferredStartMonth
      ? new Date(Date.UTC(inquiry.preferredStartYear, inquiry.preferredStartMonth - 1, 1)) : null;
    const localVersionIds = parsedUrls.flatMap(({ pathname }) => {
      const match = pathname.match(/\/resources\/[0-9a-f-]{36}\/versions\/([0-9a-f-]{36})\/download$/i);
      return match ? [match[1]!] : [];
    });
    const age = inquiry?.studentAge;
    const versions = await prisma.resourceVersion.findMany({
      where: {
        isCurrent: true,
        OR: [{ id: { in: localVersionIds } }, { sourceType: 'EXTERNAL_LINK', fileUrl: { in: urls } }],
        resource: {
          AND: resourceEligibilityFilters(targetDate),
          ...(inquiry?.countryId ? { countryId: inquiry.countryId } : {}),
          ...(inquiry?.familyId ? { familyId: inquiry.familyId } : {}),
          ...(!inquiry?.locationId && inquiry?.programId ? { programId: inquiry.programId } : {}),
          ...(inquiry?.locationId ? { OR: [
            { locationId: inquiry.locationId },
            { locationAssignments: { some: { locationId: inquiry.locationId } } },
          ] } : {}),
        },
      },
      select: {
        id: true, fileUrl: true, sourceType: true, fileName: true, mimeType: true,
        resource: { select: {
          id: true, title: true, active: true, type: true, year: true, shareFrom: true, shareUntil: true,
          validFrom: true, validUntil: true, minAge: true, maxAge: true,
          family: { select: { key: true } }, program: { select: { minAge: true, maxAge: true } },
        } },
      },
    });
    const allowed = versions.filter(({ resource }) => {
      const minAge = resource.minAge ?? resource.program?.minAge;
      const maxAge = resource.maxAge ?? resource.program?.maxAge;
      return resourceValidityStatus(resource) === 'CURRENT'
        && resourceTripCompatibility(resource, inquiry?.preferredStartMonth, inquiry?.preferredStartYear) !== 'INCOMPATIBLE'
        && (age == null || ((minAge == null || age >= minAge) && (maxAge == null || age <= maxAge)));
    });
    const matchesUrl = (version: (typeof allowed)[number], { url, pathname }: (typeof parsedUrls)[number]) => version.sourceType === 'EXTERNAL_LINK'
      ? version.fileUrl === url
      : pathname.endsWith(`/resources/${version.resource.id}/versions/${version.id}/download`);
    return {
      urls: parsedUrls.filter((url) => allowed.some((version) => matchesUrl(version, url))).map(({ url }) => url),
      versions: allowed.filter((version) => parsedUrls.some((url) => matchesUrl(version, url)))
        .map((version) => ({ resourceId: version.resource.id, versionId: version.id, fileName: resourceDocumentName(version.resource.title, version.fileName), resourceTitle: version.resource.title, mimeType: version.mimeType, url: parsedUrls.find((url) => matchesUrl(version, url))!.url })),
    };
  }
}
