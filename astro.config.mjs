// @ts-check
import { defineConfig } from 'astro/config';

// https://astro.build/config
export default defineConfig({
  site: 'https://Exist-a.github.io',
  base: '/Exist-Blog',
  markdown: {
    // 双主题：白底用 github-light，暗色用 github-dark，
    // 配合 global.css 里 [data-theme="dark"] 下的 Shiki CSS 变量覆盖做切换。
    shikiConfig: {
      themes: {
        light: 'github-light',
        dark: 'github-dark',
      },
      wrap: false,
    },
  },
});
