import { defineConfig } from "vitest/config";
import path from "path";

export default defineConfig({
  // Match Next's automatic JSX runtime so .tsx modules under test don't need a
  // `React` import in scope.
  esbuild: { jsx: "automatic" },
  resolve: {
    alias: {
      "@": path.resolve(__dirname),
    },
  },
  test: {
    include: ["**/__tests__/**/*.test.ts", "**/*.test.ts"],
    // .claude/worktrees holds other branches' checkouts; their test files would
    // resolve `@/` to THIS tree's source and test the wrong code.
    exclude: ["node_modules", ".claude/**"],
  },
});
