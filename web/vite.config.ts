import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

declare const process: { env: Record<string, string | undefined> };  // no @types/node needed

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    fs: { allow: [".."] },
    proxy: { "/api": process.env.CATALYST_API ?? "http://localhost:8000" },
  },
});
