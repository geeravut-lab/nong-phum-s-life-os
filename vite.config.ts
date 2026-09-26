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
  build: {
    rollupOptions: {
      output: {
        /**
         * Keep the third-party libraries out of the app's own entry chunk.
         *
         * Everything shared landed in one 560 kB index chunk, so any change to
         * our code - a label, a fix - invalidated React, the router, Supabase
         * and Radix along with it, and every returning visitor downloaded the
         * lot again. Splitting by package group gives those libraries their own
         * long-lived files: they only change when the dependency does.
         *
         * Whole packages stay together (react with react-dom, all of
         * @tanstack), because splitting inside a package is what breaks
         * initialisation order.
         */
        manualChunks(id) {
          if (!id.includes("node_modules")) return undefined;
          if (/[\\/]node_modules[\\/](react|react-dom|scheduler)[\\/]/.test(id))
            return "vendor-react";
          if (id.includes("node_modules/@tanstack/")) return "vendor-tanstack";
          if (id.includes("node_modules/@supabase/")) return "vendor-supabase";
          if (id.includes("node_modules/@radix-ui/")) return "vendor-radix";
          if (id.includes("node_modules/lucide-react/")) return "vendor-icons";
          if (id.includes("node_modules/zod/")) return "vendor-zod";
          return undefined;
        },
      },
    },
  },
});
