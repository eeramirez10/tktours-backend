import { prisma } from '../shared/infrastructure/database/prisma.js';

async function main() {
  const contact = await prisma.contact.upsert({
    where: { waId: '5215550000001' },
    update: {
      firstName: 'Erick',
      lastName: 'Ramirez',
      phone: '+525550000001',
      city: 'Monterrey',
      notes: 'Contacto de prueba concierge',
    },
    create: {
      waId: '5215550000001',
      firstName: 'Erick',
      lastName: 'Ramirez',
      phone: '+525550000001',
      city: 'Monterrey',
      notes: 'Contacto de prueba concierge',
    },
  });

  const existingConversation = await prisma.conversation.findFirst({
    where: {
      contactId: contact.id,
      channel: 'WHATSAPP',
      contextJson: {
        path: ['source'],
        equals: 'manual-e2e-seed',
      },
    },
    select: { id: true },
  });

  const conversation = existingConversation
    ? await prisma.conversation.update({
        where: { id: existingConversation.id },
        data: {
          status: 'OPEN',
          currentStage: 'START',
          contextJson: {
            source: 'manual-e2e-seed',
            note: 'Conversation reset for concierge test',
          },
          lastMessageAt: null,
        },
      })
    : await prisma.conversation.create({
        data: {
          contactId: contact.id,
          channel: 'WHATSAPP',
          status: 'OPEN',
          currentStage: 'START',
          contextJson: {
            source: 'manual-e2e-seed',
            note: 'Conversation created for concierge test',
          },
        },
      });

  await prisma.message.deleteMany({
    where: { conversationId: conversation.id },
  });

  await prisma.inquiryRecommendation.deleteMany({
    where: { inquiry: { conversationId: conversation.id } },
  });

  await prisma.inquiryResourceSend.deleteMany({
    where: { inquiry: { conversationId: conversation.id } },
  });

  await prisma.inquiry.deleteMany({
    where: { conversationId: conversation.id },
  });

  const inboundMessage = await prisma.message.create({
    data: {
      conversationId: conversation.id,
      direction: 'INBOUND',
      text: 'Hola, busco un curso de idiomas en Canadá para octubre y tengo 19 años',
      providerMessageId: `manual-msg-${Date.now()}`,
      metadata: {
        source: 'manual-e2e-seed',
      },
    },
  });

  await prisma.conversation.update({
    where: { id: conversation.id },
    data: {
      lastMessageAt: inboundMessage.createdAt,
    },
  });

  const country = await prisma.country.findUniqueOrThrow({
    where: { code: 'CA' },
    select: { id: true },
  });

  const family = await prisma.productFamily.findUniqueOrThrow({
    where: { key: 'LANGUAGE_COURSE' },
    select: { id: true },
  });

  const accommodationType = await prisma.accommodationType.findUniqueOrThrow({
    where: { key: 'SHARED_APARTMENT' },
    select: { id: true },
  });

  const inquiry = await prisma.inquiry.create({
    data: {
      conversationId: conversation.id,
      contactId: contact.id,
      countryId: country.id,
      familyId: family.id,
      studentAge: 19,
      cityOfResidence: 'Monterrey',
      preferredStartMonth: 10,
      preferredStartYear: 2026,
      accommodationTypeId: accommodationType.id,
      weeks: 8,
      status: 'OPEN',
      notes: 'Lead creado para prueba concierge',
      qualificationJson: {
        source: 'manual-e2e-seed',
        confidence: 'high',
      },
    },
  });

  console.log('\nConcierge test seed ready:\n');
  console.log(`conversationId=${conversation.id}`);
  console.log(`incomingMessageId=${inboundMessage.id}`);
  console.log(`inquiryId=${inquiry.id}`);
  console.log('\nUse these in http/concierge.http\n');
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
