import { build } from 'vite';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const distDir = path.resolve(__dirname, 'dist');

async function runBuild() {
  console.log('[Build] Cleaning dist directory...');
  if (fs.existsSync(distDir)) {
    fs.rmSync(distDir, { recursive: true, force: true });
  }
  fs.mkdirSync(distDir, { recursive: true });

  console.log('[Build] 1/3 Building Side Panel...');
  await build({
    root: path.resolve(__dirname, 'src/sidepanel'),
    base: '',
    build: {
      outDir: path.resolve(distDir, 'src/sidepanel'),
      emptyOutDir: false,
      rollupOptions: {
        input: path.resolve(__dirname, 'src/sidepanel/index.html')
      }
    }
  });

  console.log('[Build] 2/3 Building Background Service Worker...');
  await build({
    build: {
      outDir: path.resolve(distDir, 'src/background'),
      emptyOutDir: false,
      lib: {
        entry: path.resolve(__dirname, 'src/background/service-worker.js'),
        formats: ['es'],
        fileName: () => 'service-worker.js'
      }
    }
  });

  console.log('[Build] 3/3 Building Content Script...');
  await build({
    build: {
      outDir: path.resolve(distDir, 'src/content'),
      emptyOutDir: false,
      lib: {
        entry: path.resolve(__dirname, 'src/content/index.js'),
        name: 'AshxScrapeContent',
        formats: ['iife'],
        fileName: () => 'index.js'
      }
    }
  });

  console.log('[Build] Copying manifest.json and icons...');
  fs.copyFileSync(
    path.resolve(__dirname, 'manifest.json'),
    path.resolve(distDir, 'manifest.json')
  );

  const iconsDist = path.resolve(distDir, 'icons');
  fs.mkdirSync(iconsDist, { recursive: true });
  for (const icon of ['icon16.png', 'icon48.png', 'icon128.png']) {
    const src = path.resolve(__dirname, 'icons', icon);
    if (fs.existsSync(src)) {
      fs.copyFileSync(src, path.resolve(iconsDist, icon));
    }
  }

  console.log('[Build] Completed successfully! Unpacked extension ready at dist/');
}

runBuild().catch((err) => {
  console.error('[Build] Failed:', err);
  process.exit(1);
});
