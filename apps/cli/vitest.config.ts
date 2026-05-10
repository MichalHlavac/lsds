import path from "node:path";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: {
      "@lsds/framework": path.resolve(__dirname, "../../packages/framework/src/index.ts"),
      "@lsds/shared": path.resolve(__dirname, "../../packages/shared/src/index.ts"),
    },
  },
  test: {
    globals: false,
    testTimeout: 120_000,
  },
});
