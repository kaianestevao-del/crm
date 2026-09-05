import { Request, Response } from "express";
import bcrypt from "bcryptjs";
import { z } from "zod";
import { Role } from "@crm/shared";
import { prisma } from "../../prisma";
import { signJwt } from "../../utils/jwt";
import { HttpError } from "../../utils/httpError";
import { registerSchema, loginSchema } from "./auth.schema";

function toAuthResponse(
  user: { id: string; name: string; email: string; signatureEnabled: boolean; signatureName: string | null },
  organizationId: string,
  organizationName: string,
  role: Role,
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
    organization: { id: organizationId, name: organizationName, role },
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
            { name: "Novo Lead", order: 0 },
            { name: "Em Contato", order: 1 },
            { name: "Negociação", order: 2 },
            { name: "Fechado", order: 3 },
          ],
        },
      },
    });
    return { user, organization, pipeline };
  });

  res.status(201).json(toAuthResponse(result.user, result.organization.id, result.organization.name, Role.OWNER));
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

  res.json(toAuthResponse(user, membership.organizationId, membership.organization.name, membership.role as Role));
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
    organization: { id: membership.organizationId, name: membership.organization.name, role: membership.role },
  });
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
