import { PrismaClient } from "@prisma/client";

export * from "@prisma/client";

let prismaInstance: PrismaClient | undefined;

export function getPrismaClient(): PrismaClient {
  if (!prismaInstance) {
    prismaInstance = new PrismaClient();
  }
  return prismaInstance;
}
