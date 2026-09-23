import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    // The unit tests never open a database connection, but modules validate the
    // environment on first access — the setup file supplies a harmless shape.
    setupFiles: ["test/setup.ts"],
  },
});
