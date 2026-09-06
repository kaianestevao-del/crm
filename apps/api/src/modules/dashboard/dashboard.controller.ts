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
    revenue,
  ] = await Promise.all([
    getPatientCounts(organizationId),
    getAvgResponseSeconds(organizationId),
    getFirstPaymentStats(organizationId),
    getRecentPayments(organizationId),
    getFollowUpOutcomes(organizationId),
    getMonthlyCohorts(organizationId),
    getRevenueStats(organizationId),
  ]);

  res.json({
    patients,
    avgResponseSeconds: avgResponse,
    avgDaysToFirstPayment: firstPayment.avgDays,
    avgMessagesToFirstPayment: firstPayment.avgMessages,
    recentPayments,
    followUpOutcomes,
    cohorts,
    revenue,
  });
}

async function getRevenueStats(organizationId: string) {
  const rows = await prisma.$queryRaw<{ total: number | null; avg_ticket: number | null; avg_ltv: number | null }[]>`
    WITH per_contact AS (
      SELECT d."contactId", SUM(dp.value) AS contact_total
      FROM "DealPayment" dp
      JOIN "Deal" d ON d.id = dp."dealId"
      WHERE d."organizationId" = ${organizationId}
      GROUP BY d."contactId"
    ),
    all_payments AS (
      SELECT dp.value
      FROM "DealPayment" dp
      JOIN "Deal" d ON d.id = dp."dealId"
      WHERE d."organizationId" = ${organizationId}
    )
    SELECT
      (SELECT SUM(value) FROM all_payments) AS total,
      (SELECT AVG(value) FROM all_payments) AS avg_ticket,
      (SELECT AVG(contact_total) FROM per_contact) AS avg_ltv
  `;
  const row = rows[0];
  return {
    total: row?.total == null ? 0 : Number(row.total),
    avgTicket: row?.avg_ticket == null ? null : Number(row.avg_ticket),
    avgLtv: row?.avg_ltv == null ? null : Number(row.avg_ltv),
  };
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
    // fp.first_paid_at >= c."createdAt" excludes contacts bulk-imported with a historical
    // payment attached — their Contact row was inserted today, so the naive diff would come
    // out negative even though the payment is real; there's no reliable per-contact arrival
    // date for those beyond the month-level tag, so they're left out of this average instead
    // of skewing it.
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
      WHERE c."organizationId" = ${organizationId} AND fp.first_paid_at >= c."createdAt"
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
      SELECT c.id, c.outcome_role, COUNT(dfc.id) AS contacts_made
      FROM classified c
      LEFT JOIN "DealFollowUpContact" dfc ON dfc."dealStageHistoryId" = c.id
      GROUP BY c.id, c.outcome_role
    )
    SELECT
      AVG(contacts_made) FILTER (WHERE outcome_role = 'ACTIVE_PATIENT') AS avg_converted,
      AVG(contacts_made) FILTER (WHERE outcome_role = 'UNFOLLOW') AS avg_lost
    FROM counts
  `;
  const row = rows[0];
  return {
    avgConverted: row?.avg_converted == null ? null : Number(row.avg_converted),
    avgLost: row?.avg_lost == null ? null : Number(row.avg_lost),
  };
}

const MONTH_NAMES_PT = [
  "Janeiro", "Fevereiro", "Março", "Abril", "Maio", "Junho",
  "Julho", "Agosto", "Setembro", "Outubro", "Novembro", "Dezembro",
];
const OLDER_BUCKET_LABEL = "2025 ou antes";

// Groups contacts by their "Mês/Ano" tag (e.g. "Setembro/2026") — set automatically on first
// contact (see the worker's tagContactWithArrivalMonth) or by the historical WaSpeed import —
// rather than Contact.createdAt, which only reflects when the *row* was inserted (wrong for
// anything bulk-imported). Any contact with none of these tags is assumed to predate the
// month-tagging system entirely, i.e. arrived in "2025 ou antes".
async function getMonthlyCohorts(organizationId: string) {
  const monthNamesPattern = MONTH_NAMES_PT.join("|");
  const rows = await prisma.$queryRawUnsafe<{ label: string; totalLeads: bigint; convertedCount: bigint }[]>(
    `
    WITH month_tags AS (
      SELECT id, name FROM "Tag"
      WHERE "organizationId" = $1 AND name ~ '^(${monthNamesPattern})/\\d{4}$'
    ),
    contact_month AS (
      SELECT DISTINCT ON (ct."contactId") ct."contactId", mt.name AS tag_name
      FROM "ContactTag" ct JOIN month_tags mt ON mt.id = ct."tagId"
    ),
    converted AS (
      SELECT DISTINCT d."contactId" FROM "Deal" d JOIN "DealPayment" dp ON dp."dealId" = d.id WHERE d."organizationId" = $1
    )
    SELECT
      COALESCE(cm.tag_name, '${OLDER_BUCKET_LABEL}') AS label,
      COUNT(*) AS "totalLeads",
      COUNT(cv."contactId") AS "convertedCount"
    FROM "Contact" c
    LEFT JOIN contact_month cm ON cm."contactId" = c.id
    LEFT JOIN converted cv ON cv."contactId" = c.id
    WHERE c."organizationId" = $1
    GROUP BY label
    `,
    organizationId,
  );

  const sorted = rows
    .map((r) => ({ label: r.label, totalLeads: Number(r.totalLeads), convertedCount: Number(r.convertedCount) }))
    .sort((a, b) => {
      if (a.label === OLDER_BUCKET_LABEL) return -1;
      if (b.label === OLDER_BUCKET_LABEL) return 1;
      const [aMonth, aYear] = a.label.split("/");
      const [bMonth, bYear] = b.label.split("/");
      if (aYear !== bYear) return Number(aYear) - Number(bYear);
      return MONTH_NAMES_PT.indexOf(aMonth) - MONTH_NAMES_PT.indexOf(bMonth);
    });
  return sorted;
}
