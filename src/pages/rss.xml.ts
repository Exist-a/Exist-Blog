import rss from '@astrojs/rss';
import { getCollection } from 'astro:content';
import type { APIContext } from 'astro';
import { categories, getCategory } from '../data/posts';

/**
 * RSS 2.0 feed —— 输出 /rss.xml。
 *
 * 用途：
 * - 让 RSS 阅读器（Feedly / Inoreader / NetNewsWire）能订阅
 * - 让 RSS 采集站（RSSHub / 一些聚合站）能自动收录新文章
 * - 给搜索引擎多一条发现新内容的渠道
 */
export async function GET(context: APIContext) {
  const posts = (await getCollection('posts'))
    // draft 文章不进 feed
    .filter((p) => !p.data.draft)
    .sort((a, b) => b.data.date.getTime() - a.data.date.getTime());

  // Astro 的 BASE_URL 在 GitHub Pages 下是 /Exist-Blog/，
  // 在 root 部署下是 /。拼到 link 上保证绝对 URL 正确。
  const base = (import.meta.env.BASE_URL || '/').replace(/\/?$/, '/');

  return rss({
    title: 'Exist Blog',
    description:
      'Exist 的个人技术博客，记录前端、后端、数据库、AI 等方向的学习笔记。',
    site: context.site!,
    // trailingSlash 与 astro.config.mjs 保持一致
    trailingSlash: true,
    items: posts.map((post) => {
      const slug = post.id.split('/').pop()!.replace(/\.md$/, '');
      const cat = getCategory(post.data.category as typeof categories[number]['slug']);
      return {
        title: post.data.title,
        pubDate: post.data.date,
        description: post.data.excerpt,
        link: `${base}blog/${post.data.category}/${slug}/`,
        categories: [cat?.label ?? post.data.category, ...post.data.tags],
        author: 'why.aexist@gmail.com (Exist)',
      };
    }),
    customData: `<language>zh-cn</language>`,
  });
}
