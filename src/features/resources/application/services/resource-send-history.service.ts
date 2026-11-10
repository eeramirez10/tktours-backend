import { randomUUID } from 'node:crypto';
import { prisma } from '../../../../shared/infrastructure/database/prisma.js';

type Version = { resourceId: string; versionId: string; url?: string };
// UNKNOWN legacy records, reservations and accepted requests all block automatic resends.
// Only a recorded transport failure or a new explicit customer request permits a retry.
export class ResourceSendHistoryService {
  async pendingVersions<T extends Version>(inquiryId: string, versions: T[], explicit = false): Promise<T[]> {
    if (!versions.length || explicit) return versions;
    const history = await prisma.inquiryResourceSend.findMany({
      where: { inquiryId, resourceId: { in: versions.map((version) => version.resourceId) } },
      orderBy: [{ sentAt: 'desc' }, { id: 'desc' }],
    });
    return versions.filter((version) => {
      const latest = history.find((send) => send.resourceVersionId === version.versionId
        || (send.resourceVersionId == null && send.resourceId === version.resourceId));
      return !latest || latest.deliveryStatus === 'FAILED';
    });
  }

  async reserve(inquiryId: string, versions: Version[], requestId: string, explicit: boolean) {
    const reservations: Array<Version & { sendId: string }> = [];
    for (const version of versions) {
      const latest = await prisma.inquiryResourceSend.findFirst({
        where: { inquiryId, resourceId: version.resourceId, OR: [
          { resourceVersionId: version.versionId }, { resourceVersionId: null },
        ] },
        orderBy: [{ sentAt: 'desc' }, { id: 'desc' }],
      });
      if (latest && latest.deliveryStatus !== 'FAILED' && !explicit) continue;
      const attemptKey = `${inquiryId}:${version.versionId}:${explicit ? `request:${requestId}` : latest ? `retry:${latest.id}` : 'initial'}`;
      const sendId = randomUUID();
      const inserted = await prisma.inquiryResourceSend.createMany({ data: {
        id: sendId, inquiryId, resourceId: version.resourceId, resourceVersionId: version.versionId,
        attemptKey, deliveryStatus: 'RESERVED', sentReason: explicit ? 'explicit_customer_request' : 'automatic_brochure',
      }, skipDuplicates: true });
      if (inserted.count) reservations.push({ ...version, sendId });
    }
    return reservations;
  }

  async recordTransportResult(sendId: string, status: string, providerMessageId: string | null) {
    await prisma.inquiryResourceSend.update({ where: { id: sendId }, data: {
      deliveryStatus: /^(failed|failed_to_request)$/i.test(status) ? 'FAILED' : status === 'UNKNOWN' ? 'UNKNOWN' : 'ACCEPTED',
      providerMessageId,
    } });
  }

  async recordStatusCallback(providerMessageId: string, status: string) {
    // A delivered/read document cannot be reopened by a late failure callback.
    const allowed = status === 'failed' ? ['RESERVED', 'UNKNOWN', 'ACCEPTED', 'FAILED']
      : status === 'read' ? ['RESERVED', 'UNKNOWN', 'ACCEPTED', 'DELIVERED', 'FAILED', 'READ']
      : status === 'delivered' ? ['RESERVED', 'UNKNOWN', 'ACCEPTED', 'FAILED', 'DELIVERED']
      : ['RESERVED', 'UNKNOWN', 'ACCEPTED'];
    await prisma.inquiryResourceSend.updateMany({
      where: { providerMessageId, deliveryStatus: { in: allowed } },
      data: { deliveryStatus: status === 'failed' ? 'FAILED' : status === 'read' ? 'READ' : status === 'delivered' ? 'DELIVERED' : 'ACCEPTED' },
    });
  }
}
