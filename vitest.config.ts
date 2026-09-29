import { defineConfig } from "vitest/config";

// Only this project's tests: `.repos/` holds reference clones with their own
// (thousands of) test files.
export default defineConfig({
  test: {
    include: ["test/**/*.test.ts"],
  },
});
