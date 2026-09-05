import bcrypt from "bcryptjs";
import {
  getPrismaClient,
  Role,
  SessionStatus,
  MessageDirection,
  MessageType,
  MessageStatus,
} from "@crm/db";

const prisma = getPrismaClient();

async function main() {
  const passwordHash = await bcrypt.hash("password123", 10);

  const owner = await prisma.user.create({
    data: { name: "Kaian Estevão", email: "kaian@auroracosmeticos.com.br", passwordHash },
  });
  const agent = await prisma.user.create({
    data: { name: "Bianca Ramos", email: "bianca@auroracosmeticos.com.br", passwordHash },
  });

  const org = await prisma.organization.create({ data: { name: "Aurora Cosméticos" } });

  await prisma.membership.create({ data: { userId: owner.id, organizationId: org.id, role: Role.OWNER } });
  await prisma.membership.create({ data: { userId: agent.id, organizationId: org.id, role: Role.AGENT } });

  const session = await prisma.whatsappSession.create({
    data: {
      organizationId: org.id,
      name: "Comercial",
      phoneNumber: "5511998765432",
      status: SessionStatus.CONNECTED,
    },
  });

  const pipeline = await prisma.pipeline.create({
    data: {
      organizationId: org.id,
      name: "Funil de Vendas",
      isDefault: true,
      stages: {
        create: [
          { name: "Novo Lead", order: 0 },
          { name: "Em Contato", order: 1 },
          { name: "Negociação", order: 2 },
          { name: "Fechado", order: 3 },
        ],
      },
    },
    include: { stages: true },
  });
  const [novoLead, emContato, negociacao, fechado] = pipeline.stages.sort((a, b) => a.order - b.order);

  const contactsData = [
    { name: "Marina Souza", phoneNumber: "5511991112222" },
    { name: "Carlos Eduardo Lima", phoneNumber: "5511992223333" },
    { name: "Fernanda Alves", phoneNumber: "5511993334444" },
    { name: "Rodrigo Nascimento", phoneNumber: "5511994445555" },
    { name: "Juliana Ferreira", phoneNumber: "5511995556666" },
    { name: "Paulo Henrique Costa", phoneNumber: "5511996667777" },
  ];

  const contacts = [];
  for (const c of contactsData) {
    const contact = await prisma.contact.create({
      data: { organizationId: org.id, name: c.name, phoneNumber: c.phoneNumber, waJid: `${c.phoneNumber}@s.whatsapp.net` },
    });
    contacts.push(contact);
  }
  const [marina, carlos, fernanda, rodrigo, juliana, paulo] = contacts;

  async function createConversation(
    contact: (typeof contacts)[number],
    assignedUserId: string | null,
    unreadCount: number,
    messages: { direction: MessageDirection; content: string; minutesAgo: number; sentByUserId?: string }[],
  ) {
    const conversation = await prisma.conversation.create({
      data: {
        organizationId: org.id,
        whatsappSessionId: session.id,
        contactId: contact.id,
        assignedUserId,
        unreadCount,
        lastMessageAt: new Date(Date.now() - messages[messages.length - 1].minutesAgo * 60_000),
      },
    });
    for (const m of messages) {
      await prisma.message.create({
        data: {
          conversationId: conversation.id,
          direction: m.direction,
          type: MessageType.TEXT,
          content: m.content,
          status: m.direction === MessageDirection.OUTBOUND ? MessageStatus.DELIVERED : MessageStatus.DELIVERED,
          sentByUserId: m.sentByUserId,
          createdAt: new Date(Date.now() - m.minutesAgo * 60_000),
        },
      });
    }
    return conversation;
  }

  await createConversation(marina, agent.id, 2, [
    { direction: MessageDirection.INBOUND, content: "Oi! Vi o post de vocês sobre o sérum vitamina C, ainda tem em estoque?", minutesAgo: 42 },
    { direction: MessageDirection.OUTBOUND, content: "Oi Marina! Tudo bem? Temos sim, chegou reposição essa semana 😊", minutesAgo: 40, sentByUserId: agent.id },
    { direction: MessageDirection.INBOUND, content: "Perfeito! Qual o valor e vocês entregam no Tatuapé?", minutesAgo: 12 },
    { direction: MessageDirection.INBOUND, content: "E tem desconto pra duas unidades?", minutesAgo: 8 },
  ]);

  await createConversation(carlos, owner.id, 0, [
    { direction: MessageDirection.OUTBOUND, content: "Bom dia Carlos! Passando pra saber se o kit que te mandei ontem chegou certinho.", minutesAgo: 180, sentByUserId: owner.id },
    { direction: MessageDirection.INBOUND, content: "Bom dia! Chegou sim, tudo certo, muito obrigado", minutesAgo: 175 },
    { direction: MessageDirection.OUTBOUND, content: "Que ótimo! Qualquer dúvida de uso é só chamar 🙌", minutesAgo: 170, sentByUserId: owner.id },
  ]);

  await createConversation(fernanda, agent.id, 1, [
    { direction: MessageDirection.INBOUND, content: "Vocês fazem revenda? Tenho um salão e queria conversar sobre preços no atacado", minutesAgo: 25 },
  ]);

  await createConversation(rodrigo, null, 3, [
    { direction: MessageDirection.INBOUND, content: "Olá, comprei um protetor solar mês passado e ele veio com o lacre violado", minutesAgo: 65 },
    { direction: MessageDirection.INBOUND, content: "Alguém pode me ajudar?", minutesAgo: 60 },
    { direction: MessageDirection.INBOUND, content: "?", minutesAgo: 15 },
  ]);

  await createConversation(juliana, owner.id, 0, [
    { direction: MessageDirection.OUTBOUND, content: "Oi Ju! Fechado então, combo hidratante + máscara por R$129, envio o link de pagamento", minutesAgo: 300, sentByUserId: owner.id },
    { direction: MessageDirection.INBOUND, content: "Fechado, pode mandar!", minutesAgo: 298 },
    { direction: MessageDirection.OUTBOUND, content: "Pagamento confirmado, vai no motoboy ainda hoje 🚀", minutesAgo: 290, sentByUserId: owner.id },
  ]);

  // Leads no funil (Kanban)
  await prisma.deal.create({ data: { organizationId: org.id, pipelineId: pipeline.id, stageId: novoLead.id, contactId: fernanda.id, title: "Revenda salão - Fernanda", value: 1200, order: 0 } });
  await prisma.deal.create({ data: { organizationId: org.id, pipelineId: pipeline.id, stageId: novoLead.id, contactId: paulo.id, title: "Kit skincare masculino", value: 189, order: 1 } });

  await prisma.deal.create({ data: { organizationId: org.id, pipelineId: pipeline.id, stageId: emContato.id, contactId: marina.id, title: "Sérum vitamina C x2", value: 218, order: 0, assignedUserId: agent.id } });

  await prisma.deal.create({ data: { organizationId: org.id, pipelineId: pipeline.id, stageId: negociacao.id, contactId: carlos.id, title: "Kit completo antissinais", value: 349, order: 0, assignedUserId: owner.id } });

  await prisma.deal.create({ data: { organizationId: org.id, pipelineId: pipeline.id, stageId: fechado.id, contactId: juliana.id, title: "Combo hidratante + máscara", value: 129, order: 0, assignedUserId: owner.id } });

  console.log("Seed concluído.");
  console.log("Login demo -> email: kaian@auroracosmeticos.com.br | senha: password123");
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
