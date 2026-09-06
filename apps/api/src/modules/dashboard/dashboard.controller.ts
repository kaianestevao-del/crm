import { Request, Response } from "express";
import { prisma } from "../../prisma";

export async function getDashboardSummary(req: Request, res: Response) {
  const organizationId = req.auth!.organizationId;

  const [
    patients,
    avgResponse,
    firstPayment,
    recentPayments,
    followUpOutcomes,
    cohorts,
  ] = await Promise.all([
    getPatientCounts(organizationId),
    getAvgResponseSeconds(organizationId),
    getFirstPaymentStats(organizationId),
    getRecentPayments(organizationId),
    getFollowUpOutcomes(organizationId),
    getMonthlyCohorts(organizationId),
  ]);

  res.json({
    patients,
    avgResponseSeconds: avgResponse,
    avgDaysToFirstPayment: firstPayment.avgDays,
    avgMessagesToFirstPayment: firstPayment.avgMessages,
    recentPayments,
    followUpOutcomes,
    cohorts,
  });
}

async function getPatientCounts(organizationId: string) {
  const [active, vencida] = await Promise.all([
    prisma.deal.count({ where: { organizationId, stage: { role: "ACTIVE_PATIENT" } } }),
    prisma.deal.count({ where: { organizationId, stage: { role: "LOST_PATIENT" } } }),
  ]);
  return { active, vencida };
}

async function getAvgResponseSeconds(organizationId: string): Promise<number | null> {
  const rows = await prisma.$queryRaw<{ avg_seconds: number | null }[]>`
    WITH ordered AS (
      SELECT
        m.direction,
        LAG(m.direction) OVER (PARTITION BY m."conversationId" ORDER BY m."createdAt") AS prev_direction,
        EXTRACT(EPOCH FROM (m."createdAt" - LAG(m."createdAt") OVER (PARTITION BY m."conversationId" ORDER BY m."createdAt"))) AS gap_seconds
      FROM "Message" m
      JOIN "Conversation" c ON c.id = m."conversationId"
      WHERE c."organizationId" = ${organizationId}
    )
    SELECT AVG(gap_seconds) AS avg_seconds FROM ordered WHERE direction = 'OUTBOUND' AND prev_direction = 'INBOUND'
  `;
  const value = rows[0]?.avg_seconds;
  return value == null ? null : Number(value);
}

async function getFirstPaymentStats(organizationId: string) {
  const [daysRows, msgRows] = await Promise.all([
    prisma.$queryRaw<{ avg_days: number | null }[]>`
      WITH first_payment AS (
        SELECT d."contactId", MIN(dp."paidAt") AS first_paid_at
        FROM "DealPayment" dp
        JOIN "Deal" d ON d.id = dp."dealId"
        WHERE d."organizationId" = ${organizationId}
        GROUP BY d."contactId"
      )
      SELECT AVG(EXTRACT(EPOCH FROM (fp.first_paid_at - c."createdAt")) / 86400.0) AS avg_days
      FROM "Contact" c
      JOIN first_payment fp ON fp."contactId" = c.id
      WHERE c."organizationId" = ${organizationId}
    `,
    prisma.$queryRaw<{ avg_inbound: number | null; avg_outbound: number | null }[]>`
      WITH first_payment AS (
        SELECT d."contactId", MIN(dp."paidAt") AS first_paid_at
        FROM "DealPayment" dp
        JOIN "Deal" d ON d.id = dp."dealId"
        WHERE d."organizationId" = ${organizationId}
        GROUP BY d."contactId"
      ),
      per_contact AS (
        SELECT
          fp."contactId",
          COUNT(m.id) FILTER (WHERE m.direction = 'INBOUND') AS inbound_count,
          COUNT(m.id) FILTER (WHERE m.direction = 'OUTBOUND') AS outbound_count
        FROM first_payment fp
        JOIN "Contact" c ON c.id = fp."contactId"
        LEFT JOIN "Conversation" conv ON conv."contactId" = c.id
        LEFT JOIN "Message" m ON m."conversationId" = conv.id AND m."createdAt" BETWEEN c."createdAt" AND fp.first_paid_at
        GROUP BY fp."contactId"
      )
      SELECT AVG(inbound_count) AS avg_inbound, AVG(outbound_count) AS avg_outbound FROM per_contact
    `,
  ]);

  const avgDays = daysRows[0]?.avg_days;
  const inbound = msgRows[0]?.avg_inbound;
  const outbound = msgRows[0]?.avg_outbound;
  return {
    avgDays: avgDays == null ? null : Number(avgDays),
    avgMessages:
      inbound == null && outbound == null
        ? null
        : { inbound: Number(inbound ?? 0), outbound: Number(outbound ?? 0), total: Number(inbound ?? 0) + Number(outbound ?? 0) },
  };
}

async function getRecentPayments(organizationId: string) {
  return prisma.$queryRaw<
    { id: string; paidAt: Date; value: number; contactName: string | null; phoneNumber: string; stageName: string; daysInStage: number }[]
  >`
    SELECT
      dp.id,
      dp."paidAt",
      dp.value,
      c.name AS "contactName",
      c."phoneNumber",
      ps.name AS "stageName",
      EXTRACT(EPOCH FROM (dp."paidAt" - dsh."enteredAt")) / 86400.0 AS "daysInStage"
    FROM "DealPayment" dp
    JOIN "Deal" d ON d.id = dp."dealId"
    JOIN "Contact" c ON c.id = d."contactId"
    JOIN "DealStageHistory" dsh ON dsh."dealId" = d.id
      AND dsh."enteredAt" <= dp."paidAt" AND (dsh."exitedAt" IS NULL OR dsh."exitedAt" > dp."paidAt")
    JOIN "PipelineStage" ps ON ps.id = dsh."stageId"
    WHERE d."organizationId" = ${organizationId}
    ORDER BY dp."paidAt" DESC
    LIMIT 20
  `;
}

async function getFollowUpOutcomes(organizationId: string) {
  const rows = await prisma.$queryRaw<{ avg_converted: number | null; avg_lost: number | null }[]>`
    WITH followup_periods AS (
      SELECT
        dsh.id, dsh."dealId", dsh."enteredAt", dsh."exitedAt",
        LEAD(dsh."stageId") OVER (PARTITION BY dsh."dealId" ORDER BY dsh."enteredAt") AS next_stage_id
      FROM "DealStageHistory" dsh
      JOIN "PipelineStage" ps ON ps.id = dsh."stageId"
      JOIN "Deal" d ON d.id = dsh."dealId"
      WHERE ps.role = 'FOLLOW_UP' AND d."organizationId" = ${organizationId} AND dsh."exitedAt" IS NOT NULL
    ),
    classified AS (
      SELECT fp.*, next_ps.role AS outcome_role
      FROM followup_periods fp
      LEFT JOIN "PipelineStage" next_ps ON next_ps.id = fp.next_stage_id
    ),
    counts AS (
      SELECT c.id, c.outcome_role, COUNT(m.id) AS outbound_sent
      FROM classified c
      JOIN "Deal" d ON d.id = c."dealId"
      JOIN "Conversation" conv ON conv."contactId" = d."contactId"
      LEFT JOIN "Message" m ON m."conversationId" = conv.id AND m.direction = 'OUTBOUND'
        AND m."createdAt" >= c."enteredAt" AND m."createdAt" < c."exitedAt"
      GROUP BY c.id, c.outcome_role
    )
    SELECT
      AVG(outbound_sent) FILTER (WHERE outcome_role = 'ACTIVE_PATIENT') AS avg_converted,
      AVG(outbound_sent) FILTER (WHERE outcome_role = 'UNFOLLOW') AS avg_lost
    FROM counts
  `;
  const row = rows[0];
  return {
    avgConverted: row?.avg_converted == null ? null : Number(row.avg_converted),
    avgLost: row?.avg_lost == null ? null : Number(row.avg_lost),
  };
}

async function getMonthlyCohorts(organizationId: string) {
  const rows = await prisma.$queryRaw<
    { cohortMonth: Date; totalLeads: bigint; convertedCount: bigint; avgDaysToConvert: number | null }[]
  >`
    WITH first_payment AS (
      SELECT d."contactId", MIN(dp."paidAt") AS first_paid_at
      FROM "DealPayment" dp
      JOIN "Deal" d ON d.id = dp."dealId"
      WHERE d."organizationId" = ${organizationId}
      GROUP BY d."contactId"
    )
    SELECT
      DATE_TRUNC('month', c."createdAt") AS "cohortMonth",
      COUNT(*) AS "totalLeads",
      COUNT(fp."contactId") AS "convertedCount",
      AVG(EXTRACT(EPOCH FROM (fp.first_paid_at - c."createdAt")) / 86400.0) FILTER (WHERE fp."contactId" IS NOT NULL) AS "avgDaysToConvert"
    FROM "Contact" c
    LEFT JOIN first_payment fp ON fp."contactId" = c.id
    WHERE c."organizationId" = ${organizationId}
    GROUP BY 1
    ORDER BY 1
  `;
  return rows.map((r) => ({
    month: r.cohortMonth,
    totalLeads: Number(r.totalLeads),
    convertedCount: Number(r.convertedCount),
    avgDaysToConvert: r.avgDaysToConvert == null ? null : Number(r.avgDaysToConvert),
  }));
}
