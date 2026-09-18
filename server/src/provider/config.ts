import type { ProviderConfig } from "@prisma/client";
import { prisma } from "../db.js";
import { decryptSecret, maskSecret } from "./crypto.js";

export async function activeProvider(): Promise<ProviderConfig | null> {
  return prisma.providerConfig.findFirst({
    where: { enabled: true },
    orderBy: { updatedAt: "desc" },
  });
}

export function providerCoversAgent(config: ProviderConfig, agentId: string): boolean {
  return config.agentScope.includes("*") || config.agentScope.includes(agentId);
}

export function toPublic(config: ProviderConfig) {
  return {
    id: config.id,
    label: config.label,
    baseUrl: config.baseUrl,
    model: config.model,
    apiKeyMasked: maskSecret(decryptSecret(config.apiKeyCipher)),
    meter: config.meter,
    tomanPer1kTokens: config.tomanPer1kTokens,
    tomanPerMinute: config.tomanPerMinute,
    agentScope: config.agentScope,
    enabled: config.enabled,
  };
}