import type { APIRoute } from 'astro';

/**
 * robots.txt —— 告诉搜索引擎哪些路径能爬、哪些不能，
 * 并指向 sitemap 便于一次性发现所有页面。
 *
 * 这里只禁掉 /tags/ 路径下的二级聚合页（避免和 /blog/<category>/
 * 重复内容）；其余全部放行。
 */
export const GET: APIRoute = ({ site }) => {
  const base = (import.meta.env.BASE_URL || '/').replace(/\/?$/, '/');
  const sitemapUrl = new URL(base + 'sitemap-index.xml', site).toString();
  const body = `User-agent: *
Allow: /
Disallow: /tags/

Sitemap: ${sitemapUrl}
`;
  return new Response(body, {
    headers: { 'Content-Type': 'text/plain; charset=utf-8' },
  });
};