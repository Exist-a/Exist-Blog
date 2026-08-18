/**
 * Content Collections 配置
 *
 * 把所有 .md 笔记统一收口到 src/content/posts/<category>/<slug>.md，
 * 通过 frontmatter 走 Zod schema 校验，避免手写 TS 数据时拼错分类。
 *
 * 路由生成依然走 src/pages/blog/[category]/[slug].astro，
 * 通过 getStaticPaths() + getCollection('posts') 拉取。
 */

import { defineCollection, z } from 'astro:content';
import { glob } from 'astro/loaders';
import { categories } from './data/posts';

const categorySlugs = categories.map(c => c.slug) as [string, ...string[]];

const posts = defineCollection({
  // 扫描 src/content/posts/**\/*.md；以文件名（去扩展名）作为 entry.id
  loader: glob({ pattern: '**/*.md', base: './src/content/posts' }),
  schema: z.object({
    title: z.string(),
    date: z.date(),
    /**
     * 文章最后更新时间（可选）。
     * 不填 → sitemap / JSON-LD / OG 全部 fallback 到 date（发布日期）。
     * 改了一次文章 → 把这个字段更新成新日期，搜索引擎会重新来抓。
     */
    updated: z.date().optional(),
    excerpt: z.string(),
    category: z.enum(categorySlugs),
    tags: z.array(z.string()).default([]),
    /**
     * 文章封面图（相对 public/ 的路径，例如 `covers/rag.png`）。
     * 不填 → fallback 到 avatar.jpg。
     * 用于：OG image（社交分享卡片）、JSON-LD image（搜索结果富媒体）。
     */
    cover: z.string().optional(),
    /**
     * 是否为草稿。true 则不构建静态页、不进 sitemap、不被搜索引擎收录。
     */
    draft: z.boolean().default(false),
  }),
});

export const collections = { posts };