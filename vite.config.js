import { defineConfig } from "vite";

export default defineConfig({
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
});
