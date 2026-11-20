import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// Tauri loads http://localhost:1420 in dev (see src-tauri/tauri.conf.json).
export default defineConfig({
  plugins: [react()],
  clearScreen: false,
  server: {
    port: 1420,
    strictPort: true,
    // Rust changes are rebuilt by cargo, not Vite.
    watch: { ignored: ["**/src-tauri/**"] },
  },
});
