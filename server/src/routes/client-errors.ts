import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { prisma } from "../db.js";
import { badRequest } from "../lib/errors.js";
import { enforceLimit } from "../lib/limiter.js";
import { readSession } from "../lib/session.js";
import { normalizeReport, type ClientReportInput } from "../lib/report.js";

/**
 * Browser crash reporting.
 *
 * The site had no way to learn that a render threw: the uptime check watches
 * HTTP, and a React tree that crashes still answers 200. These two routes close
 * that gap — `/api/client-errors` accepts a report from any visitor (it must
 * work when the app is broken and the session cookie is the last thing on the
 * client's mind), and the admin route is where a human reads them.
 *
 * Reports are deduplicated by fingerprint, so a bug hitting a thousand visitors
 * is one row with `count: 1000` rather than a thousand rows.
 */

/**
 * Deliberately permissive: a report that fails validation is a report nobody
 * ever sees, and the caller is a broken page. Unknown kinds are accepted and
 * stored as `unknown`; lengths are capped in `normalizeReport`.
 */
const reportInput = z.object({
  kind: z.string().max(40).optional(),
  message: z.string().max(2_000).optional(),
  stack: z.string().max(8_000).optional(),
  source: z.string().max(500).optional(),
  route: z.string().max(500).optional(),
  release: z.string().max(120).optional(),
  lang: z.string().max(16).optional(),
  viewport: z.string().max(40).optional(),
});

/** A page that is crash-looping must not be able to fill the table by itself. */
const REPORT_LIMITS = [
  { windowSeconds: 60, max: 10 },
  { windowSeconds: 3_600, max: 120 },
];

const MAX_REPORTS_PER_BODY = 20;

export async function clientErrorRoutes(app: FastifyInstance): Promise<void> {
  app.post("/api/client-errors", async (req, reply) => {
    const body = req.body as { reports?: unknown } | null;
    const raw = Array.isArray(body?.reports) ? body.reports : [];
    if (raw.length === 0) throw badRequest("reports_required");
    if (raw.length > MAX_REPORTS_PER_BODY) throw badRequest("too_many_reports");

    const parsed = z.array(reportInput).safeParse(raw);
    if (!parsed.success) throw badRequest("invalid_report", parsed.error.issues);

    // One request, one rate-limit charge: a batch is a single flush from one
    // page, so counting each report separately would punish a batch for existing.
    await enforceLimit(`client-error:${req.ip}`, REPORT_LIMITS);

    // Attribution is best-effort: the report matters more than the identity, and
    // the query only runs when a session cookie is actually present.
    const session = req.cookies?.["agentfa_session"] ? await readSession(req) : null;

    const userAgent = (req.headers["user-agent"] ?? "").slice(0, 300);
    let stored = 0;

    for (const report of parsed.data) {
      const normalized = normalizeReport(report as ClientReportInput);
      await prisma.clientError.upsert({
        where: { fingerprint: normalized.fingerprint },
        create: {
          ...normalized,
          userAgent,
          userId: session?.id ?? null,
        },
        update: {
          count: { increment: 1 },
          lastSeenAt: new Date(),
          // The latest sighting is the most useful one: a stack can gain frames
          // as a bug moves, and the newest release is the one being fixed.
          stack: normalized.stack,
          release: normalized.release,
          route: normalized.route,
          userAgent,
          viewport: normalized.viewport,
          lang: normalized.lang,
          ...(session?.id ? { userId: session.id } : {}),
        },
      });
      stored += 1;
    }

    // 202: the report is recorded, not acted upon. The client never waits for
    // anything more, and a failure here must not become a second error.
    return reply.status(202).send({ stored });
  });

  /** What the admin panel reads. Newest activity first, grouped. */
  app.get("/api/admin/client-errors", async (req, reply) => {
    await app.requireAdmin(req, reply);
    const query = z
      .object({ limit: z.coerce.number().int().min(1).max(100).default(50) })
      .safeParse(req.query);
    const limit = query.success ? query.data.limit : 50;

    const errors = await prisma.clientError.findMany({
      orderBy: { lastSeenAt: "desc" },
      take: limit,
    });

    const [total, since24h] = await Promise.all([
      prisma.clientError.count(),
      prisma.clientError.count({ where: { lastSeenAt: { gte: new Date(Date.now() - 86_400_000) } } }),
    ]);

    return { errors, total, groupsLast24h: since24h };
  });
}
