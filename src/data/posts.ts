/**
 * Taxonomy + 分类/标签枚举
 *
 * P3 之后：所有文章内容统一收口到 src/content/posts/<category>/<slug>.md，
 * 由 src/content.config.ts 的 schema 校验 frontmatter。
 *
 * 本文件只保留：
 *   - 一级分类 categories
 *   - 二级标签 subcategories
 *   - 查询辅助函数（基于 getCollection）
 */

import { getCollection, type CollectionEntry } from 'astro:content';

export interface PostSummary {
  slug: string;
  title: string;
  date: Date;
  excerpt: string;
  category: CategorySlug;
  tags: string[];
}

/* ── 一级分类 ─────────────────────────────────────────── */

export const categories = [
  { slug: 'frontend', label: '前端'   },
  { slug: 'backend',  label: '后端'   },
  { slug: 'database', label: '数据库' },
  { slug: 'ai',       label: 'AI'     },
] as const;

export type CategorySlug = typeof categories[number]['slug'];

/* ── 二级 tag ─────────────────────────────────────────── */

export const subcategories = {
  frontend: [
    { slug: 'react',      label: 'React'     },
    { slug: 'vue',        label: 'Vue'       },
    { slug: 'html',       label: 'HTML'      },
    { slug: 'css',        label: 'CSS'       },
    { slug: 'javascript', label: 'JavaScript'},
    { slug: 'nextjs',     label: 'Next.js'   },
  ],
  backend: [
    { slug: 'go',      label: 'Go'             },
    { slug: 'api',     label: 'API 设计'        },
    { slug: 'pg-perf', label: 'Postgres 性能'   },
  ],
  database: [
    { slug: 'postgres', label: 'PostgreSQL' },
    { slug: 'mysql',    label: 'MySQL'      },
  ],
  ai: [
    { slug: 'rag',   label: 'RAG'    },
    { slug: 'agent', label: 'Agent' },
  ],
} as const;

export type SubcategorySlug =
  typeof subcategories[CategorySlug][number]['slug'];

/* ── 查询辅助 ─────────────────────────────────────────── */

export type PostEntry = CollectionEntry<'posts'>;

/** entry → 列表页用的扁平 summary（去掉 body / render 等重字段） */
export function toSummary(entry: PostEntry): PostSummary {
  return {
    slug: entry.id.split('/').pop()!.replace(/\.md$/, ''),
    title: entry.data.title,
    date: entry.data.date,
    excerpt: entry.data.excerpt,
    category: entry.data.category,
    tags: entry.data.tags,
  };
}

export async function allPostSummaries(): Promise<PostSummary[]> {
  const entries = await getCollection('posts');
  return entries.map(toSummary);
}

export async function postsByCategory(cat: CategorySlug): Promise<PostSummary[]> {
  const entries = await getCollection('posts', p => p.data.category === cat);
  return entries.map(toSummary);
}

export async function postsByTag(tag: string): Promise<PostSummary[]> {
  const entries = await getCollection('posts', p => p.data.tags.includes(tag));
  return entries.map(toSummary);
}

export function postsSortedDesc(posts: PostSummary[]): PostSummary[] {
  return [...posts].sort((a, b) => b.date.getTime() - a.date.getTime());
}

export function getCategory(slug: string) {
  return categories.find(c => c.slug === slug);
}

export function getSubcategory(slug: string) {
  for (const cat of Object.keys(subcategories) as CategorySlug[]) {
    const found = subcategories[cat].find(s => s.slug === slug);
    if (found) return { ...found, category: cat };
  }
  return undefined;
}