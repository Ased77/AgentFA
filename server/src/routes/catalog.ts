import type { FastifyInstance } from "fastify";
import { loadCatalog } from "../provider/catalog.js";

export async function catalogRoutes(app: FastifyInstance): Promise<void> {
  app.get("/catalog", async () => loadCatalog());
}