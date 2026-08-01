import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

// Tauri-recommended dev server settings: fixed port matching
// src-tauri/tauri.conf.json's devUrl, and ignore src-tauri/ so a Rust
// rebuild doesn't trigger a frontend HMR reload.
// https://v2.tauri.app/start/frontend/
export default defineConfig({
  plugins: [react(), tailwindcss()],
  clearScreen: false,
  server: {
    port: 1420,
    strictPort: true,
    watch: {
      ignored: ["**/src-tauri/**"],
    },
  },
});
