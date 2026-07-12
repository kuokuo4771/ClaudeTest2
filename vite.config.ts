import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { viteSingleFile } from 'vite-plugin-singlefile';

// singlefile: JS/CSSをすべてindex.htmlにインライン化。
// 生成されたdist/index.htmlは単体で動くため、ダウンロードして
// ダブルクリックするだけで起動できる(サーバー・ターミナル不要)。
export default defineConfig({
  plugins: [react(), viteSingleFile()],
  base: './',
});
