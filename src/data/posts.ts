/**
 * Posts & taxonomies
 *
 * 当前阶段用 TS 对象作为占位数据；
 * P3 会换成 src/content/posts/*.md 的 Content Collections，
 * taxonomy 仍然按这套 category + tag 二级结构走。
 */

export interface Post {
  slug: string;
  title: string;
  date: string;        // YYYY-MM-DD
  excerpt: string;
  category: CategorySlug;
  tags: SubcategorySlug[];   // 一篇文章通常归属 1 个 tag
}

/* ── 一级分类 ─────────────────────────────────────────── */

export const categories = [
  { slug: 'frontend', label: '前端'   },
  { slug: 'backend',  label: '后端'   },
  { slug: 'database', label: '数据库' },
  { slug: 'ai',       label: 'AI'     },
] as const;

export type CategorySlug = typeof categories[number]['slug'];

export const categoryDescriptions: Record<CategorySlug, string> = {
  frontend: 'React / Next.js / CSS / 浏览器 —— 我从写 div 那天起就在学的领域。',
  backend:  'Go / Node.js / API 设计 —— 把前端不能解决的问题搬到这里。',
  database: 'PostgreSQL / MySQL —— 不只是写 SQL，是索引、隔离级别和连接池。',
  ai:       'RAG / Agent / LLM —— 现在做的事。',
};

/* ── 二级 tag ─────────────────────────────────────────── */

export const subcategories = {
  frontend: [
    { slug: 'react',  label: 'React'   },
    { slug: 'css',    label: 'CSS'     },
    { slug: 'nextjs', label: 'Next.js' },
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
    { slug: 'llm',   label: 'LLM'    },
  ],
} as const;

export type SubcategorySlug =
  typeof subcategories[CategorySlug][number]['slug'];

/* ── 文章 ─────────────────────────────────────────────── */

export const allPosts: Post[] = [
  // ── 前端 ──
  { slug: 'react-server-components-deep-dive',
    title: 'React Server Components：从请求到流的完整链路',
    date: '2026-07-02',
    excerpt: 'RSC 不是渲染优化，是一种新的架构边界。把 server / client 拆开后，水合成本、网络瀑布、缓存策略都变了。',
    category: 'frontend', tags: ['react'] },

  { slug: 'css-container-queries-real-use',
    title: 'Container Queries 在真实项目里到底怎么用',
    date: '2026-06-28',
    excerpt: 'media query 问的是视口，container query 问的是父容器。后者终于让"组件真正可复用"成为可能。',
    category: 'frontend', tags: ['css'] },

  { slug: 'nextjs-app-router-tradeoffs',
    title: 'Next.js App Router 的取舍：一年后回头看',
    date: '2026-06-15',
    excerpt: '从 Pages Router 迁到 App Router 一年了。streaming、server actions、嵌套 layout 都好用，但有些坑藏得很深。',
    category: 'frontend', tags: ['nextjs'] },

  // ── 后端 ──
  { slug: 'go-context-cancellation',
    title: 'Go 的 context 取消传播：一张图看懂',
    date: '2026-06-30',
    excerpt: 'context 不是参数，是"取消信号 + 截止时间 + 值传递"的三合一。写错过的人都栽在同一处。',
    category: 'backend', tags: ['go'] },

  { slug: 'rest-vs-graphql-vs-trpc',
    title: 'REST vs GraphQL vs tRPC：2026 年的选型',
    date: '2026-06-10',
    excerpt: '三个都不是银弹。中小项目用 tRPC 提速明显，但当团队 / BFF / 跨端都进来，REST 的简单反而赢。',
    category: 'backend', tags: ['api'] },

  { slug: 'postgres-connection-pool-pitfalls',
    title: 'Postgres 连接池：pgbouncer 在事务模式下踩过的坑',
    date: '2026-05-22',
    excerpt: '事务模式、session 模式、statement 模式 —— 三种模式的 prepared statement 行为完全不同。',
    category: 'backend', tags: ['pg-perf'] },

  // ── 数据库 ──
  { slug: 'postgres-index-types',
    title: 'Postgres 索引全家桶：B-tree / Hash / GIN / BRIN',
    date: '2026-06-25',
    excerpt: 'B-tree 之外还有三个常用索引。GIN 给数组和 jsonb，BRIN 给时序数据，省 90% 空间。',
    category: 'database', tags: ['postgres'] },

  { slug: 'mysql-isolation-levels',
    title: 'MySQL 隔离级别：从脏读到幻读的真实代价',
    date: '2026-06-08',
    excerpt: 'RR 不是"绝对安全"，是"够用"。很多团队不知道快照读和当前读的区别，写出看似正确其实会脏写的代码。',
    category: 'database', tags: ['mysql'] },

  // ── AI ──
  { slug: 'rag-from-scratch',
    title: 'RAG 不是"塞进向量数据库就完事"',
    date: '2026-07-01',
    excerpt: 'chunk 切分、embedding 选型、rerank、query rewrite —— 真实项目里这四步每一步都能把效果拉一档。',
    category: 'ai', tags: ['rag'] },

  { slug: 'function-calling-vs-mcp',
    title: 'Function Calling vs MCP：什么时候该用哪个',
    date: '2026-06-20',
    excerpt: 'function calling 是"模型调用工具"，MCP 是"工具的标准协议"。短期看是替代关系，长期看是互补。',
    category: 'ai', tags: ['agent'] },

  { slug: 'token-economics',
    title: '大模型的 token 经济：为什么你的账单总是超预期',
    date: '2026-06-05',
    excerpt: 'input / output 价格差 5 倍，cache hit 便宜 10 倍，thinking token 还要单独算。一篇把账算清楚。',
    category: 'ai', tags: ['llm'] },
];

/* ── 查询辅助 ─────────────────────────────────────────── */

export function postsByCategory(cat: CategorySlug): Post[] {
  return allPosts.filter(p => p.category === cat);
}

export function postsByTag(tag: string): Post[] {
  return allPosts.filter(p => p.tags.includes(tag as SubcategorySlug));
}

export function postsSortedDesc(posts: Post[]): Post[] {
  return [...posts].sort((a, b) => b.date.localeCompare(a.date));
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