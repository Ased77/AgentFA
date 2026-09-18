import { z } from "zod";

const url = z
  .string()
  .trim()
  .url()
  .refine((value) => /^https?:\/\//i.test(value), "baseUrl must use http(s)")
  .transform((value) => value.replace(/\/+$/, ""));

export const providerInput = z.object({
  label: z.string().trim().max(100).default(""),
  baseUrl: url,
  model: z.string().trim().min(1).max(200),
  apiKey: z.string().trim().max(2000).optional(),
  meter: z.enum(["tokens", "time"]).default("tokens"),
  tomanPer1kTokens: z.coerce.number().int().min(0).max(10_000_000).default(2000),
  tomanPerMinute: z.coerce.number().int().min(0).max(10_000_000).default(30000),
  agentScope: z.array(z.string().trim().min(1).max(200)).min(1).default(["*"]),
  enabled: z.boolean().default(true),
});

export function endpointFor(baseUrl: string): string {
  return `${baseUrl.replace(/\/+$/, "")}/chat/completions`;
}