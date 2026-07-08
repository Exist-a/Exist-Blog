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
    excerpt: z.string(),
    category: z.enum(categorySlugs),
    tags: z.array(z.string()).default([]),
  }),
});

export const collections = { posts };