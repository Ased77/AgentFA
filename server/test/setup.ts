// Unit tests run without Postgres or Redis. Only the *shape* of the environment
// matters: the modules under test are pure, and the Prisma client that some of
// them import never opens a connection until a query runs.
process.env.NODE_ENV ??= "test";
process.env.DATABASE_URL ??= "postgresql://agentfa:agentfa@localhost:5432/agentfa";
process.env.PROVIDER_KEY_SECRET ??= "0".repeat(64);
process.env.PUBLIC_API_URL ??= "http://localhost:8787";
process.env.PUBLIC_WEB_URL ??= "http://localhost:8443";
