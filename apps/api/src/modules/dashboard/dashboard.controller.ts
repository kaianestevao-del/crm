import { Request, Response } from "express";
import { MONTH_NAMES_PT, ORIGIN_TAGS_PT } from "@crm/shared";
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
    funnel,
  ] = await Promise.all([
    getPatientCounts(organizationId),
    getAvgResponseSeconds(organizationId),
    getFirstPaymentStats(organizationId),
    getRecentPayments(organizationId),
    getFollowUpOutcomes(organizationId),
    getMonthlyCohorts(organizationId),
    getRevenueStats(organizationId),
    getMessageFunnel(organizationId),
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
    funnel,
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

// Counts every message of the contact's conversations up to their first payment, with no lower
// bound at Contact.createdAt: history-synced / imported messages carry their real (older)
// createdAt while the Contact row is inserted later, so the old `BETWEEN c.createdAt AND paidAt`
// silently dropped them — a freshly-paid patient could show up with 0 messages.
// "Start" of the relationship = the contact's first message. Only payers with message history in
// the CRM count: patients bulk-imported with a historical payment have no messages here, and
// including them would drag every average to ~0.
async function getFirstPaymentStats(organizationId: string) {
  const rows = await prisma.$queryRaw<
    { avg_days: number | null; avg_inbound: number | null; avg_outbound: number | null }[]
  >`
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
        fp.first_paid_at,
        COALESCE(MIN(m."createdAt"), c."createdAt") AS started_at,
        COUNT(m.id) FILTER (WHERE m.direction = 'INBOUND' AND m."createdAt" <= fp.first_paid_at) AS inbound_count,
        COUNT(m.id) FILTER (WHERE m.direction = 'OUTBOUND' AND m."createdAt" <= fp.first_paid_at) AS outbound_count
      FROM first_payment fp
      JOIN "Contact" c ON c.id = fp."contactId"
      LEFT JOIN "Conversation" conv ON conv."contactId" = c.id
      LEFT JOIN "Message" m ON m."conversationId" = conv.id
      GROUP BY fp."contactId", fp.first_paid_at, c."createdAt"
      HAVING COUNT(m.id) > 0
    )
    SELECT
      AVG(EXTRACT(EPOCH FROM (first_paid_at - started_at)) / 86400.0) FILTER (WHERE first_paid_at >= started_at) AS avg_days,
      AVG(inbound_count) AS avg_inbound,
      AVG(outbound_count) AS avg_outbound
    FROM per_contact
  `;

  const row = rows[0];
  const inbound = row?.avg_inbound;
  const outbound = row?.avg_outbound;
  return {
    avgDays: row?.avg_days == null ? null : Number(row.avg_days),
    avgMessages:
      inbound == null && outbound == null
        ? null
        : { inbound: Number(inbound ?? 0), outbound: Number(outbound ?? 0), total: Number(inbound ?? 0) + Number(outbound ?? 0) },
  };
}

// Conversion + give-up effort, over contacts that have message history in the CRM. Patients
// bulk-imported with a historical payment (no messages here) are reported separately as
// `paidWithoutHistory` instead of being counted as "contacted" — otherwise they inflate the rate.
async function getMessageFunnel(organizationId: string) {
  const rows = await prisma.$queryRaw<
    {
      contacted: bigint;
      converted: bigint;
      outbound_total: bigint | null;
      paid_without_history: bigint;
      gave_up: bigint;
      avg_outbound_gave_up: number | null;
    }[]
  >`
    WITH first_payment AS (
      SELECT d."contactId", MIN(dp."paidAt") AS first_paid_at
      FROM "DealPayment" dp JOIN "Deal" d ON d.id = dp."dealId"
      WHERE d."organizationId" = ${organizationId}
      GROUP BY d."contactId"
    ),
    unfollow AS (
      SELECT d."contactId", MAX(dsh."enteredAt") AS gave_up_at
      FROM "Deal" d
      JOIN "PipelineStage" ps ON ps.id = d."stageId" AND ps.role = 'UNFOLLOW'
      JOIN "DealStageHistory" dsh ON dsh."dealId" = d.id AND dsh."stageId" = ps.id
      WHERE d."organizationId" = ${organizationId}
      GROUP BY d."contactId"
    ),
    per_contact AS (
      SELECT
        c.id,
        fp.first_paid_at,
        uf.gave_up_at,
        COUNT(m.id) AS msg_total,
        COUNT(m.id) FILTER (WHERE m.direction = 'OUTBOUND') AS out_total,
        COUNT(m.id) FILTER (WHERE m.direction = 'OUTBOUND' AND uf.gave_up_at IS NOT NULL AND m."createdAt" <= uf.gave_up_at) AS out_to_give_up
      FROM "Contact" c
      LEFT JOIN first_payment fp ON fp."contactId" = c.id
      LEFT JOIN unfollow uf ON uf."contactId" = c.id
      LEFT JOIN "Conversation" conv ON conv."contactId" = c.id
      LEFT JOIN "Message" m ON m."conversationId" = conv.id
      WHERE c."organizationId" = ${organizationId}
      GROUP BY c.id, fp.first_paid_at, uf.gave_up_at
    )
    SELECT
      COUNT(*) FILTER (WHERE msg_total > 0) AS contacted,
      COUNT(*) FILTER (WHERE msg_total > 0 AND first_paid_at IS NOT NULL) AS converted,
      SUM(out_total) FILTER (WHERE msg_total > 0) AS outbound_total,
      COUNT(*) FILTER (WHERE msg_total = 0 AND first_paid_at IS NOT NULL) AS paid_without_history,
      COUNT(*) FILTER (WHERE msg_total > 0 AND gave_up_at IS NOT NULL AND first_paid_at IS NULL) AS gave_up,
      AVG(out_to_give_up) FILTER (WHERE msg_total > 0 AND gave_up_at IS NOT NULL AND first_paid_at IS NULL) AS avg_outbound_gave_up
    FROM per_contact
  `;
  const r = rows[0];
  const contacted = Number(r?.contacted ?? 0);
  const converted = Number(r?.converted ?? 0);
  return {
    contacted,
    converted,
    conversionRate: contacted > 0 ? converted / contacted : null,
    outboundTotal: Number(r?.outbound_total ?? 0),
    paidWithoutHistory: Number(r?.paid_without_history ?? 0),
    gaveUp: Number(r?.gave_up ?? 0),
    avgOutboundUntilGiveUp: r?.avg_outbound_gave_up == null ? null : Number(r.avg_outbound_gave_up),
  };
}

// LEFT JOINs against DealStageHistory on purpose: a deal created by a bulk import (Deal.createdAt
// = import time) whose payment.paidAt is a real historical date has no stage-history row covering
// that instant (the only row starts at import time, after the payment) — an INNER JOIN there would
// silently drop that payment from the list instead of just missing its "days in stage" detail.
// Falls back to the deal's current stage name so every payment still shows up.
async function getRecentPayments(organizationId: string) {
  return prisma.$queryRaw<
    { id: string; paidAt: Date; value: number; contactName: string | null; phoneNumber: string; stageName: string; daysInStage: number | null }[]
  >`
    SELECT
      dp.id,
      dp."paidAt",
      dp.value,
      c.name AS "contactName",
      c."phoneNumber",
      COALESCE(ps_time.name, ps_current.name) AS "stageName",
      EXTRACT(EPOCH FROM (dp."paidAt" - dsh."enteredAt")) / 86400.0 AS "daysInStage"
    FROM "DealPayment" dp
    JOIN "Deal" d ON d.id = dp."dealId"
    JOIN "Contact" c ON c.id = d."contactId"
    LEFT JOIN "DealStageHistory" dsh ON dsh."dealId" = d.id
      AND dsh."enteredAt" <= dp."paidAt" AND (dsh."exitedAt" IS NULL OR dsh."exitedAt" > dp."paidAt")
    LEFT JOIN "PipelineStage" ps_time ON ps_time.id = dsh."stageId"
    JOIN "PipelineStage" ps_current ON ps_current.id = d."stageId"
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

const OLDER_BUCKET_LABEL = "2025 ou antes";
const OTHER_ORIGIN_LABEL = "Outra origem";

// Groups contacts by their "Mês/Ano" tag (e.g. "Setembro/2026") — set automatically on first
// contact (see the worker's tagContactWithArrivalMonth) or by the historical WaSpeed import —
// rather than Contact.createdAt, which only reflects when the *row* was inserted (wrong for
// anything bulk-imported). Any contact with none of these tags is assumed to predate the
// month-tagging system entirely, i.e. arrived in "2025 ou antes". Each month row is further
// broken down by acquisition-channel tag so the dashboard can drill down into "where did this
// month's leads come from".
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

  const channelRows = await prisma.$queryRawUnsafe<
    { monthLabel: string; channelLabel: string; totalLeads: bigint; convertedCount: bigint }[]
  >(
    `
    WITH month_tags AS (
      SELECT id, name FROM "Tag"
      WHERE "organizationId" = $1 AND name ~ '^(${monthNamesPattern})/\\d{4}$'
    ),
    contact_month AS (
      SELECT DISTINCT ON (ct."contactId") ct."contactId", mt.name AS tag_name
      FROM "ContactTag" ct JOIN month_tags mt ON mt.id = ct."tagId"
    ),
    origin_tags AS (
      SELECT id, name FROM "Tag"
      WHERE "organizationId" = $1 AND name = ANY($2::text[])
    ),
    contact_origin AS (
      SELECT DISTINCT ON (ct."contactId") ct."contactId", ot.name AS origin_name
      FROM "ContactTag" ct JOIN origin_tags ot ON ot.id = ct."tagId"
    ),
    converted AS (
      SELECT DISTINCT d."contactId" FROM "Deal" d JOIN "DealPayment" dp ON dp."dealId" = d.id WHERE d."organizationId" = $1
    )
    SELECT
      COALESCE(cm.tag_name, '${OLDER_BUCKET_LABEL}') AS "monthLabel",
      COALESCE(co.origin_name, '${OTHER_ORIGIN_LABEL}') AS "channelLabel",
      COUNT(*) AS "totalLeads",
      COUNT(cv."contactId") AS "convertedCount"
    FROM "Contact" c
    LEFT JOIN contact_month cm ON cm."contactId" = c.id
    LEFT JOIN contact_origin co ON co."contactId" = c.id
    LEFT JOIN converted cv ON cv."contactId" = c.id
    WHERE c."organizationId" = $1
    GROUP BY "monthLabel", "channelLabel"
    `,
    organizationId,
    ORIGIN_TAGS_PT,
  );

  const channelsByMonth = new Map<string, { name: string; totalLeads: number; convertedCount: number }[]>();
  for (const r of channelRows) {
    const list = channelsByMonth.get(r.monthLabel) ?? [];
    list.push({ name: r.channelLabel, totalLeads: Number(r.totalLeads), convertedCount: Number(r.convertedCount) });
    channelsByMonth.set(r.monthLabel, list);
  }
  for (const list of channelsByMonth.values()) {
    list.sort((a, b) => b.totalLeads - a.totalLeads);
  }

  const sorted = rows
    .map((r) => ({
      label: r.label,
      totalLeads: Number(r.totalLeads),
      convertedCount: Number(r.convertedCount),
      channels: channelsByMonth.get(r.label) ?? [],
    }))
    .sort((a, b) => {
      if (a.label === OLDER_BUCKET_LABEL) return -1;
      if (b.label === OLDER_BUCKET_LABEL) return 1;
      const [aMonth, aYear] = a.label.split("/");
      const [bMonth, bYear] = b.label.split("/");
      if (aYear !== bYear) return Number(aYear) - Number(bYear);
      return (MONTH_NAMES_PT as readonly string[]).indexOf(aMonth) - (MONTH_NAMES_PT as readonly string[]).indexOf(bMonth);
    });
  return sorted;
}

// Drill-down behind the cohort's magnifier: who arrived in `month` through `channel`, and who
// converted. Uses the same month/channel bucketing as getMonthlyCohorts so the numbers match.
export async function getChannelLeads(req: Request, res: Response) {
  const organizationId = req.auth!.organizationId;
  const month = String(req.query.month ?? "");
  const channel = String(req.query.channel ?? "");
  if (!month || !channel) return res.status(400).json({ error: "month_and_channel_required" });

  const monthNamesPattern = MONTH_NAMES_PT.join("|");
  const rows = await prisma.$queryRawUnsafe<
    {
      contactId: string;
      name: string | null;
      phoneNumber: string;
      converted: boolean;
      firstPaidAt: Date | null;
      totalPaid: number | null;
      inbound: bigint;
      outbound: bigint;
    }[]
  >(
    `
    WITH month_tags AS (
      SELECT id, name FROM "Tag"
      WHERE "organizationId" = $1 AND name ~ '^(${monthNamesPattern})/\\d{4}$'
    ),
    contact_month AS (
      SELECT DISTINCT ON (ct."contactId") ct."contactId", mt.name AS tag_name
      FROM "ContactTag" ct JOIN month_tags mt ON mt.id = ct."tagId"
    ),
    origin_tags AS (
      SELECT id, name FROM "Tag" WHERE "organizationId" = $1 AND name = ANY($2::text[])
    ),
    contact_origin AS (
      SELECT DISTINCT ON (ct."contactId") ct."contactId", ot.name AS origin_name
      FROM "ContactTag" ct JOIN origin_tags ot ON ot.id = ct."tagId"
    ),
    pay AS (
      SELECT d."contactId", MIN(dp."paidAt") AS first_paid_at, SUM(dp.value) AS total_paid
      FROM "Deal" d JOIN "DealPayment" dp ON dp."dealId" = d.id
      WHERE d."organizationId" = $1
      GROUP BY d."contactId"
    )
    SELECT
      c.id AS "contactId",
      c.name,
      c."phoneNumber",
      (pay.first_paid_at IS NOT NULL) AS converted,
      pay.first_paid_at AS "firstPaidAt",
      pay.total_paid AS "totalPaid",
      COUNT(m.id) FILTER (WHERE m.direction = 'INBOUND' AND (pay.first_paid_at IS NULL OR m."createdAt" <= pay.first_paid_at)) AS inbound,
      COUNT(m.id) FILTER (WHERE m.direction = 'OUTBOUND' AND (pay.first_paid_at IS NULL OR m."createdAt" <= pay.first_paid_at)) AS outbound
    FROM "Contact" c
    LEFT JOIN contact_month cm ON cm."contactId" = c.id
    LEFT JOIN contact_origin co ON co."contactId" = c.id
    LEFT JOIN pay ON pay."contactId" = c.id
    LEFT JOIN "Conversation" conv ON conv."contactId" = c.id
    LEFT JOIN "Message" m ON m."conversationId" = conv.id
    WHERE c."organizationId" = $1
      AND COALESCE(cm.tag_name, '${OLDER_BUCKET_LABEL}') = $3
      AND COALESCE(co.origin_name, '${OTHER_ORIGIN_LABEL}') = $4
    GROUP BY c.id, c.name, c."phoneNumber", pay.first_paid_at, pay.total_paid
    ORDER BY converted DESC, c.name ASC NULLS LAST
    `,
    organizationId,
    ORIGIN_TAGS_PT,
    month,
    channel,
  );

  res.json(
    rows.map((r) => ({
      contactId: r.contactId,
      name: r.name,
      phoneNumber: r.phoneNumber,
      converted: r.converted,
      firstPaidAt: r.firstPaidAt,
      totalPaid: r.totalPaid == null ? null : Number(r.totalPaid),
      inbound: Number(r.inbound),
      outbound: Number(r.outbound),
    })),
  );
}
