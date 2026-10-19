import fs from 'node:fs';
import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';

// Writes yoru-bundle.json into every web build: the Android APK versionCode this UI was built
// against (WebUpdaterPlugin.java refuses the OTA bundle on any other APK) and its web version.
function yoruBundleInfo(): Plugin {
  return {
    name: 'yoru-bundle-info',
    apply: 'build',
    generateBundle() {
      const gradle = fs.readFileSync(new URL('./android/app/build.gradle', import.meta.url), 'utf8');
      const stable = JSON.parse(fs.readFileSync(new URL('./stable.json', import.meta.url), 'utf8'));
      const versionCode = gradle.match(/versionCode\s+(\d+)/);
      if (!versionCode) throw new Error('No se pudo leer versionCode desde android/app/build.gradle.');
      this.emitFile({
        type: 'asset',
        fileName: 'yoru-bundle.json',
        source: `${JSON.stringify({ webVersion: stable.hotUpdateVersion, androidVersionCode: Number(versionCode[1]) }, null, 2)}\n`
      });
    }
  };
}

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), yoruBundleInfo()],
  base: './',
});
