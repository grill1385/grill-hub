import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// base './' torna os caminhos relativos — funciona no GitHub Pages
// (https://<user>.github.io/<repo>/) sem configuração adicional.
export default defineConfig({
  plugins: [react()],
  base: "./",
});
