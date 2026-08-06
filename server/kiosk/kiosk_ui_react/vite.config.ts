import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// Relative base so Flask (server.py) can serve the built dist/ from any
// mount path without needing an absolute-URL rewrite.
export default defineConfig({
  plugins: [react()],
  base: "./",
  build: {
    outDir: "dist",
  },
  server: {
    port: 5173,
    proxy: {
      // The Flask UI server (server.py) — Socket.IO + REST endpoints
      // (/api/state, /api/qr-token, /camera/face/stream, etc.)
      "/api": "http://localhost:8080",
      "/camera": "http://localhost:8080",
      "/socket.io": {
        target: "http://localhost:8080",
        ws: true,
      },
    },
  },
});
