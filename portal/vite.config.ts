import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react-swc";
import path from "path";
import { componentTagger } from "lovable-tagger";
// @ts-expect-error - CommonJS module shared with the Jest test suite
import { assertAppBuildConfig } from "./src/lib/app-build-guard.cjs";

// https://vitejs.dev/config/
export default defineConfig(({ mode }) => {
  // `--mode app` (npm run build:app) is the bundle the Android app ships; it
  // must carry an absolute https API url or it white-screens on launch.
  assertAppBuildConfig({ mode, env: loadEnv(mode, process.cwd(), "") });

  return {
    server: {
      host: "::",
      port: 8080,
    },
    plugins: [react(), mode === "development" && componentTagger()].filter(Boolean),
    resolve: {
      alias: {
        "@": path.resolve(__dirname, "./src"),
      },
    },
  };
});
