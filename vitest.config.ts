import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    globals: true,
    environment: "node",
    restoreMocks: true,
    exclude: ["dist/**", "node_modules/**"]
  }
});
