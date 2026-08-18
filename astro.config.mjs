// @ts-check
import { defineConfig } from 'astro/config';
import sitemap from '@astrojs/sitemap';
import { execSync } from 'node:child_process';
import { readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

// 拿单篇文章的 git 最后修改时间，作为 sitemap <lastmod> 的兜底。
// 文章 frontmatter 有 updated 字段则优先用 updated。
function getGitLastmod(filePath) {
  try {
    const iso = execSync(`git log -1 --format=%cI -- "${filePath}"`, {
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'pipe'],
    }).trim();
    return iso ? new Date(iso) : null;
  } catch {
    return null;
  }
}

// https://astro.build/config
export default defineConfig({
  site: 'https://Exist-a.github.io',
  base: '/Exist-Blog',
  // 与 GitHub Pages 默认行为对齐：所有页面强制带尾斜杠。
  // 这点很关键：与 sitemap 的 <loc> 一致，避免 canonical 与 sitemap 互相打架
  // （带斜杠 vs 不带斜杠会让 Google 把所有信号都打折）。
  trailingSlash: 'always',
  integrations: [
    // 自动生成 sitemap-index.xml，提交到 Google / Bing 即可被收录
    sitemap({
      // /tags/* 是聚合页，和 /blog/<category>/ 内容重复，不进 sitemap
      filter: (page) => !page.includes('/tags/'),

      // 给每条 URL 注入 <lastmod> + 合理的 <changefreq>/<priority>。
      // 来源优先级：frontmatter.updated → 文件 mtime → git log → 构建时间
      serialize(item) {
        // item.url 是相对路径，例如 /Exist-Blog/blog/ai/what-is-rag/
        const absUrl = new URL(item.url, item.origin ?? 'https://exist-a.github.io').href;
        // 从 URL 推断可能对应的源 .md 路径
        const slugPath = absUrl
          .replace(/^https?:\/\/[^/]+\/Exist-Blog\//, '')
          .replace(/\/$/, '');

        // 尝试从 content collection 反查 frontmatter.updated
        let lastmod = null;
        try {
          const mdPath = join('src/content/posts', slugPath + '.md');
          const txt = readFileSync(mdPath, 'utf-8');
          const m = txt.match(/^updated:\s*(.+)$/m);
          if (m) {
            const d = new Date(m[1].trim());
            if (!Number.isNaN(d.getTime())) lastmod = d;
          }
          if (!lastmod) {
            // fallback 1: 文件 mtime
            const st = statSync(mdPath);
            lastmod = st.mtime;
          }
        } catch {
          // md 文件找不到（首页 / about / 列表页），用 git log 或构建时间
        }
        if (!lastmod) lastmod = getGitLastmod(slugPath);
        if (!lastmod) lastmod = new Date();

        // 优先级：首页 / 分类页 0.8、文章页 1.0、其它 0.5
        const isArticle = /\/blog\/[^/]+\/[^/]+\/?$/.test(absUrl);
        const isCategory = /\/blog\/[^/]+\/?$/.test(absUrl) && !isArticle;
        const isHome = absUrl.endsWith('/Exist-Blog/') || absUrl.endsWith('/Exist-Blog');
        const priority = isArticle ? 1.0 : isCategory ? 0.8 : isHome ? 0.9 : 0.5;
        const changefreq = isArticle ? 'weekly' : isCategory ? 'weekly' : 'daily';

        return {
          ...item,
          lastmod,
          changefreq,
          priority,
        };
      },
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
