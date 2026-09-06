import { defineConfig } from "vite";
import { tanstackStart } from "@tanstack/react-start/plugin/vite";
import netlify from "@netlify/vite-plugin-tanstack-start";
import viteReact from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import tsConfigPaths from "vite-tsconfig-paths";

export default defineConfig({
  plugins: [
    tsConfigPaths(),
    tailwindcss(),
    tanstackStart({
      // Redirect TanStack Start's server entry to src/server.ts (our SSR error wrapper).
      server: { entry: "server" },
    }),
    // Edge Functions emulation needs a Deno runtime that fails to start on Windows
    // ("unexpected argument '--allow-scripts'"). The SSR handler deploys to regular
    // Netlify Functions (edgeSSR defaults to false), so nothing here uses them.
    netlify({ dev: { edgeFunctions: { enabled: false } } }),
    viteReact(),
  ],
  resolve: {
    dedupe: ["react", "react-dom", "@tanstack/react-router"],
  },
});
