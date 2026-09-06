import { Request, Response } from "express";
import bcrypt from "bcryptjs";
import { z } from "zod";
import { MODULE_KEYS, Role } from "@crm/shared";
import { prisma } from "../../prisma";
import { HttpError } from "../../utils/httpError";

function requireManager(role: Role) {
  if (role !== Role.OWNER && role !== Role.ADMIN) {
    throw new HttpError(403, "only_owner_or_admin_can_manage_team");
  }
}

const moduleKeysSchema = z.array(z.enum(MODULE_KEYS));

export async function listTeam(req: Request, res: Response) {
  const memberships = await prisma.membership.findMany({
    where: { organizationId: req.auth!.organizationId },
    include: { user: { select: { id: true, name: true, email: true } } },
    orderBy: { createdAt: "asc" },
  });
  res.json(memberships.map((m) => ({ membershipId: m.id, role: m.role, allowedModules: m.allowedModules, ...m.user })));
}

const inviteSchema = z.object({
  name: z.string().min(2),
  email: z.string().email(),
  password: z.string().min(8),
  role: z.nativeEnum(Role).default(Role.AGENT),
  // Only meaningful when role is AGENT — OWNER/ADMIN always have full access. Defaults to every
  // module (an owner unchecks what they don't want this specific hire seeing) rather than
  // starting empty.
  allowedModules: moduleKeysSchema.default([...MODULE_KEYS]),
});

// There's no email-invite infrastructure — an OWNER/ADMIN creates the teammate's login
// directly (name, e-mail, initial password) the same way the very first account is created
// at registration, just added to this organization instead of a brand-new one.
export async function inviteTeamMember(req: Request, res: Response) {
  const auth = req.auth!;
  requireManager(auth.role);
  const input = inviteSchema.parse(req.body);

  if (input.role === Role.OWNER) {
    throw new HttpError(400, "cannot_invite_as_owner");
  }

  const existingUser = await prisma.user.findUnique({ where: { email: input.email } });
  if (existingUser) {
    const existingMembership = await prisma.membership.findUnique({
      where: { userId_organizationId: { userId: existingUser.id, organizationId: auth.organizationId } },
    });
    if (existingMembership) throw new HttpError(409, "already_a_team_member");
    throw new HttpError(409, "email_already_registered_elsewhere");
  }

  const passwordHash = await bcrypt.hash(input.password, 10);
  const result = await prisma.$transaction(async (tx) => {
    const user = await tx.user.create({ data: { name: input.name, email: input.email, passwordHash } });
    const membership = await tx.membership.create({
      data: {
        userId: user.id,
        organizationId: auth.organizationId,
        role: input.role,
        allowedModules: input.role === Role.AGENT ? input.allowedModules : [],
      },
    });
    return { user, membership };
  });

  res.status(201).json({
    membershipId: result.membership.id,
    role: result.membership.role,
    allowedModules: result.membership.allowedModules,
    id: result.user.id,
    name: result.user.name,
    email: result.user.email,
  });
}

const updateSchema = z.object({
  role: z.nativeEnum(Role).optional(),
  allowedModules: moduleKeysSchema.optional(),
});

export async function updateTeamMember(req: Request, res: Response) {
  const auth = req.auth!;
  requireManager(auth.role);
  const input = updateSchema.parse(req.body);

  const membership = await prisma.membership.findFirst({
    where: { id: req.params.id, organizationId: auth.organizationId },
  });
  if (!membership) throw new HttpError(404, "team_member_not_found");

  if (input.role && membership.role === Role.OWNER && input.role !== Role.OWNER) {
    const ownerCount = await prisma.membership.count({ where: { organizationId: auth.organizationId, role: Role.OWNER } });
    if (ownerCount <= 1) throw new HttpError(400, "cannot_demote_last_owner");
  }

  const nextRole = input.role ?? membership.role;
  const updated = await prisma.membership.update({
    where: { id: membership.id },
    data: {
      ...(input.role ? { role: input.role } : {}),
      // Non-AGENT roles never carry restrictions — always full access.
      ...(input.allowedModules ? { allowedModules: nextRole === Role.AGENT ? input.allowedModules : [] } : {}),
      ...(input.role && input.role !== Role.AGENT ? { allowedModules: [] } : {}),
    },
  });
  res.json({ membershipId: updated.id, role: updated.role, allowedModules: updated.allowedModules });
}

// Removes the teammate from THIS organization only (deletes the Membership, never the User) —
// their name still shows correctly on every message/deal/note they ever touched, since those
// reference the User directly and are untouched by this.
export async function removeTeamMember(req: Request, res: Response) {
  const auth = req.auth!;
  requireManager(auth.role);

  const membership = await prisma.membership.findFirst({
    where: { id: req.params.id, organizationId: auth.organizationId },
  });
  if (!membership) throw new HttpError(404, "team_member_not_found");

  if (membership.userId === auth.sub) throw new HttpError(400, "cannot_remove_yourself");

  if (membership.role === Role.OWNER) {
    const ownerCount = await prisma.membership.count({ where: { organizationId: auth.organizationId, role: Role.OWNER } });
    if (ownerCount <= 1) throw new HttpError(400, "cannot_remove_last_owner");
  }

  await prisma.membership.delete({ where: { id: membership.id } });
  res.json({ ok: true });
}
