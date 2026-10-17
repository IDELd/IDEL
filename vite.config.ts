import { defineConfig, PluginOption } from "vite";
import { enterDevPlugin, enterProdPlugin } from 'vite-plugin-enter-dev';
import path from "path";

// https://vitejs.dev/config/
export default defineConfig(({ mode }) => {
  const plugins = [
    ...enterProdPlugin(),
  ];
  if (mode === 'development') {
    plugins.push(...enterDevPlugin());
  }
  return {
    server: {
      host: "::",
      port: 8080,
    },
    plugins: plugins.filter(Boolean) as PluginOption[],
    resolve: {
      alias: {
        "@": path.resolve(__dirname, "./src"),
      },
    },
    // База для деплоя: GitHub Pages раздаёт проект из подпапки (/<repo>/),
    // поэтому в CI передаём VITE_BASE=/<repo>/. Локально — "/".
    base: process.env.VITE_BASE || '/',
    build: {
      outDir: 'dist',
      // Всегда чистим dist: иначе старые чанки попадают в артефакт Pages.
      emptyOutDir: true,
    }
  };
});