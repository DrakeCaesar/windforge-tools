import { defineConfig } from "vite";

/**
 * Baked into the client so IndexedDB cache keys change on each production build (or CI commit).
 * Set `VITE_DEPLOY_ID` in CI, or rely on `GITHUB_SHA` on GitHub Actions; otherwise each
 * `vite build` uses a fresh timestamp in production.
 */
function resolveDeployBuildId(mode) {
  const fromEnv = (process.env.VITE_DEPLOY_ID || process.env.GITHUB_SHA || "").trim();
  if (fromEnv) return fromEnv;
  if (mode === "production") {
    return "build-" + Date.now();
  }
  return "";
}

export default defineConfig(({ mode }) => {
  const deployBuildId = resolveDeployBuildId(mode);
  return {
    root: ".",
    base: "./",
    publicDir: "public",
    server: {
      open: true,
    },
    build: {
      outDir: "dist",
      emptyOutDir: true,
    },
    define: {
      __DEPLOY_BUILD_ID__: JSON.stringify(deployBuildId),
    },
  };
});
