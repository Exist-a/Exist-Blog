// @ts-check
import { defineConfig } from 'astro/config';
import sitemap from '@astrojs/sitemap';

// https://astro.build/config
export default defineConfig({
  site: 'https://Exist-a.github.io',
  base: '/Exist-Blog',
  integrations: [
    // 自动生成 sitemap-index.xml，提交到 Google / Bing 即可被收录
    sitemap({
      // /tags/* 是聚合页，和 /blog/<category>/ 内容重复，不进 sitemap
      filter: (page) => !page.includes('/tags/'),
    }),
  ],
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
