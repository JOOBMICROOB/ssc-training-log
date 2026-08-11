import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// The app shell is added in a later slice; this config already supports it.
export default defineConfig({
  plugins: [react()],
  test: {
    globals: true,
    environment: "node",
    include: ["src/**/*.test.ts"],
  },
});
