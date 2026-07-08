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
  body?: string;             // 可选 HTML 正文；未填则文章页只显示 frontmatter
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
  {
    slug: 'react-useeffect-closure',
    title: 'React useEffect 的闭包陷阱：为什么 state 总是旧的',
    date: '2026-07-08',
    excerpt: 'useEffect 的依赖数组不会"重新绑定"已经声明的回调里的 state。如果你在 setInterval / 事件监听里读到的永远是初始值，这一篇把根因和三种修法讲清楚。',
    category: 'frontend',
    tags: ['react'],
    body: `
<p>这是一个几乎每个写过 React 的人都会踩一次的坑：你写了一个 <code>setInterval</code>，想在回调里读最新的 state，但它永远打印初始值。</p>

<h2>问题复现</h2>

<pre><code>function Counter() {
  const [count, setCount] = useState(0);

  useEffect(() =&gt; {
    const id = setInterval(() =&gt; {
      console.log(count); // 永远打印 0
    }, 1000);
    return () =&gt; clearInterval(id);
  }, []); // 空依赖：effect 只在挂载时跑一次

  return &lt;button onClick={() =&gt; setCount(c =&gt; c + 1)}&gt;{count}&lt;/button&gt;
}</code></pre>

<p>点按钮，<code>count</code> 明明变了。但控制台始终打印 <code>0</code>。</p>

<h2>为什么</h2>

<p><code>useEffect</code> 的依赖数组决定的是"什么时候重新执行 effect"，不是"什么时候重新读取闭包变量"。</p>

<p>第一次渲染时，effect 跑了一次，把当时的 <code>count</code>（也就是 <code>0</code>）闭包进了 <code>setInterval</code> 的回调里。之后 <code>count</code> 变了，但闭包里那份引用没变 —— 回调每次读的还是当初那个 <code>0</code>。</p>

<p>依赖数组是 <code>[]</code>，effect 不再执行。React 也不会"穿透"回去更新那个已经创建的闭包。</p>

<h2>三种修法</h2>

<ol>
<li><strong>把依赖加上</strong>。最简单，但要小心：依赖变化会让 effect 反复 cleanup/setup，<code>setInterval</code> 会不停重启。</li>
<li><strong>用 ref 存最新值</strong>。ref 的 <code>.current</code> 是可变容器，effect 依赖它但不会触发重新执行；回调里读 <code>countRef.current</code> 总是最新的。</li>
<li><strong>用函数式 setState</strong>。如果只是想基于上一次的值更新，<code>setCount(c =&gt; c + 1)</code> 永远拿到最新值，不需要把 <code>count</code> 读进闭包。</li>
</ol>

<h2>ref 写法参考</h2>

<pre><code>function Counter() {
  const [count, setCount] = useState(0);
  const countRef = useRef(count);

  useEffect(() =&gt; {
    countRef.current = count; // 每次渲染后同步
  });

  useEffect(() =&gt; {
    const id = setInterval(() =&gt; {
      console.log(countRef.current); // 永远是最新的
    }, 1000);
    return () =&gt; clearInterval(id);
  }, []);

  return &lt;button onClick={() =&gt; setCount(c =&gt; c + 1)}&gt;{count}&lt;/button&gt;
}</code></pre>

<p>核心就一句话：闭包捕获的是变量名，不是变量的值。要么让 effect 重跑（依赖数组），要么换一种方式读最新值（ref / 函数式更新），不能既不让它重跑、又指望它读新值。</p>
`,
  },
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