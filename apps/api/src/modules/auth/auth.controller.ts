import { Request, Response } from "express";
import bcrypt from "bcryptjs";
import { z } from "zod";
import { MODULE_KEYS, Role } from "@crm/shared";
import { prisma } from "../../prisma";
import { signJwt } from "../../utils/jwt";
import { HttpError } from "../../utils/httpError";
import { registerSchema, loginSchema } from "./auth.schema";

// OWNER/ADMIN always have full access regardless of what's stored — resolving that here means
// the frontend never has to special-case role when deciding whether to show a module.
function effectiveAllowedModules(role: Role, storedAllowedModules: string[]): string[] {
  return role === Role.AGENT ? storedAllowedModules : [...MODULE_KEYS];
}

function toAuthResponse(
  user: { id: string; name: string; email: string; signatureEnabled: boolean; signatureName: string | null },
  organizationId: string,
  organizationName: string,
  role: Role,
  allowedModules: string[],
) {
  return {
    token: signJwt({ sub: user.id, organizationId, role }),
    user: {
      id: user.id,
      name: user.name,
      email: user.email,
      signatureEnabled: user.signatureEnabled,
      signatureName: user.signatureName,
    },
    organization: { id: organizationId, name: organizationName, role, allowedModules },
  };
}

export async function register(req: Request, res: Response) {
  const input = registerSchema.parse(req.body);

  const existing = await prisma.user.findUnique({ where: { email: input.email } });
  if (existing) throw new HttpError(409, "email_already_registered");

  const passwordHash = await bcrypt.hash(input.password, 10);

  const result = await prisma.$transaction(async (tx) => {
    const user = await tx.user.create({
      data: { name: input.name, email: input.email, passwordHash },
    });
    const organization = await tx.organization.create({
      data: { name: input.organizationName },
    });
    await tx.membership.create({
      data: { userId: user.id, organizationId: organization.id, role: Role.OWNER },
    });
    const pipeline = await tx.pipeline.create({
      data: {
        organizationId: organization.id,
        name: "Funil Padrão",
        isDefault: true,
        stages: {
          create: [
            { name: "Em Atendimento", order: 0 },
            { name: "Apresentação", order: 1 },
            { name: "Negociação", order: 2 },
            { name: "Fechamento", order: 3 },
            { name: "Follow-up", order: 4 },
            { name: "Unfollow", order: 5 },
          ],
        },
      },
    });
    return { user, organization, pipeline };
  });

  res.status(201).json(
    toAuthResponse(result.user, result.organization.id, result.organization.name, Role.OWNER, effectiveAllowedModules(Role.OWNER, [])),
  );
}

export async function login(req: Request, res: Response) {
  const input = loginSchema.parse(req.body);

  const user = await prisma.user.findUnique({
    where: { email: input.email },
    include: { memberships: { include: { organization: true } } },
  });
  if (!user) throw new HttpError(401, "invalid_credentials");

  const valid = await bcrypt.compare(input.password, user.passwordHash);
  if (!valid) throw new HttpError(401, "invalid_credentials");

  const membership = user.memberships[0];
  if (!membership) throw new HttpError(403, "no_organization_membership");

  const role = membership.role as Role;
  res.json(
    toAuthResponse(user, membership.organizationId, membership.organization.name, role, effectiveAllowedModules(role, membership.allowedModules)),
  );
}

export async function me(req: Request, res: Response) {
  const auth = req.auth!;
  const user = await prisma.user.findUnique({ where: { id: auth.sub } });
  const membership = await prisma.membership.findUnique({
    where: { userId_organizationId: { userId: auth.sub, organizationId: auth.organizationId } },
    include: { organization: true },
  });
  if (!user || !membership) throw new HttpError(404, "not_found");

  res.json({
    user: {
      id: user.id,
      name: user.name,
      email: user.email,
      signatureEnabled: user.signatureEnabled,
      signatureName: user.signatureName,
    },
    organization: {
      id: membership.organizationId,
      name: membership.organization.name,
      role: membership.role,
      allowedModules: effectiveAllowedModules(membership.role as Role, membership.allowedModules),
    },
  });
}

const changePasswordSchema = z.object({
  currentPassword: z.string().min(1),
  newPassword: z.string().min(8),
});

export async function changePassword(req: Request, res: Response) {
  const input = changePasswordSchema.parse(req.body);
  const user = await prisma.user.findUniqueOrThrow({ where: { id: req.auth!.sub } });

  const valid = await bcrypt.compare(input.currentPassword, user.passwordHash);
  if (!valid) throw new HttpError(401, "current_password_incorrect");

  const passwordHash = await bcrypt.hash(input.newPassword, 10);
  await prisma.user.update({ where: { id: user.id }, data: { passwordHash } });
  res.json({ ok: true });
}

const updateMeSchema = z.object({
  signatureEnabled: z.boolean().optional(),
  signatureName: z.string().nullable().optional(),
});

export async function updateMe(req: Request, res: Response) {
  const input = updateMeSchema.parse(req.body);
  const user = await prisma.user.update({
    where: { id: req.auth!.sub },
    data: {
      signatureEnabled: input.signatureEnabled,
      signatureName: input.signatureName === undefined ? undefined : input.signatureName?.trim() || null,
    },
  });
  res.json({
    id: user.id,
    name: user.name,
    email: user.email,
    signatureEnabled: user.signatureEnabled,
    signatureName: user.signatureName,
  });
}
