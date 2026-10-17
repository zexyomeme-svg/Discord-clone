import path from "path";
import { fileURLToPath } from "url";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig, loadEnv } from "vite";
import { viteSingleFile } from "vite-plugin-singlefile";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// https://vite.dev/config/
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, __dirname, "");

  // `npm run dev` previously had no proxy, so every call the app made to the
  // same-origin Flask routes (/api/discord/*, /api/oauth/config, /auth/*) fell
  // through to Vite's SPA fallback and returned index.html with HTTP 200. The
  // frontend then failed to JSON.parse the HTML and login() reported a bogus
  // "Invalid token" error. Proxying to the Flask server makes dev mode work.
  const backend = env.FLASK_BACKEND_URL || "http://127.0.0.1:8000";

  return {
    plugins: [react(), tailwindcss(), viteSingleFile()],
    resolve: {
      alias: {
        "@": path.resolve(__dirname, "src"),
      },
    },
    server: {
      host: "0.0.0.0",
      port: Number(env.PORT_DEV || 5173),
      strictPort: false,
      // Accept requests arriving through tunnelled/preview hostnames.
      allowedHosts: true,
      proxy: {
        "/api": {
          target: backend,
          changeOrigin: true,
          xfwd: true,
        },
        "/auth": {
          target: backend,
          changeOrigin: true,
          xfwd: true,
        },
        "/healthz": {
          target: backend,
          changeOrigin: true,
          xfwd: true,
        },
      },
    },
    preview: {
      host: "0.0.0.0",
      allowedHosts: true,
      proxy: {
        "/api": { target: backend, changeOrigin: true, xfwd: true },
        "/auth": { target: backend, changeOrigin: true, xfwd: true },
        "/healthz": { target: backend, changeOrigin: true, xfwd: true },
      },
    },
  };
});
