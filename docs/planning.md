# exist-blog 项目规划

> 创建日期：2026-07-04
> 状态：P0 完成（npm install 通过），待进入 P1

---

## 1. 一句话定位
**前端转 AI 全栈开发者的个人知识库**——把学习笔记按 4 个技术栈维度沉淀，附个人简介作为 hiring 入口。

## 2. 技术栈

| 项 | 选择 | 原因 |
|---|---|---|
| 框架 | Astro | 内容站首选，.md → 静态页，零 JS 默认 |
| 样式 | 原生 CSS（CSS Variables + 主题） | Astro 默认集成，零依赖 |
| 内容 | 手写 .md 提交到 git | 用户决定，无 CMS |
| 部署 | GitHub Pages | 免费，Actions 自动构建 |
| 域名 | 暂用 `exist-a.github.io`（**独立域名预留 CNAME 钩子**） | GitHub 用户名是 Exist-a（不是 lenvov） |
| 主题 | 交给 frontend-design skill 决定 | 不脑补，交给设计 |

## 3. 内容分类（4 类 + 个人简介）

- **前端** (`/blog/frontend/`)
- **后端** (`/blog/backend/`)
- **数据库** (`/blog/database/`)
- **AI** (`/blog/ai/`)
- **关于我** (`/about`)

## 4. 站点结构

```
exist-blog/
├── .github/workflows/deploy.yml      ← GitHub Actions 自动部署
├── astro.config.mjs                  ← site + base config
├── public/CNAME                      ← 预留独立域名（现在空着）
├── src/
│   ├── pages/
│   │   ├── index.astro               ← 首页（hero + 4 分类卡 + 最新文）
│   │   ├── about.astro               ← 个人简介（独立页）
│   │   └── blog/
│   │       ├── index.astro           ← 全部文章（时间倒序）
│   │       ├── frontend.astro        ← 前端分类
│   │       ├── backend.astro         ← 后端分类
│   │       ├── database.astro        ← 数据库分类
│   │       └── ai.astro              ← AI 分类
│   ├── layouts/
│   │   └── BaseLayout.astro          ← 全站骨架（导航/页脚）
│   ├── components/
│   │   ├── Nav.astro                 ← 顶部导航
│   │   ├── ArticleCard.astro         ← 文章卡片（首页/列表用）
│   │   └── CategoryCard.astro        ← 分类卡片（首页用）
│   ├── content/                      ← Astro Content Collections
│   │   ├── config.ts                 ← 4 个分类的 schema
│   │   └── posts/
│   │       ├── frontend/             ← 前端文章 .md
│   │       ├── backend/
│   │       ├── database/
│   │       └── ai/
│   └── styles/
│       └── global.css                ← CSS Variables + 主题
└── package.json
```

## 5. 内容模型（每篇 .md 的 frontmatter）

```yaml
---
title: '文章标题'
description: '一句话简介'
pubDate: 2026-07-04
category: frontend | backend | database | ai   ← 强制 4 选 1
tags: [React, 性能优化]                        ← 可选
draft: false
---
```

`src/content/config.ts` 用 Zod schema 强制约束 `category` 只能取这 4 个值——避免以后手写 .md 时拼错。

## 6. 首页信息架构

```
[Nav: 首页 | 前端 | 后端 | 数据库 | AI | 关于]

─────────────────────────────────────
  Hero 区
  ├ 你的名字 + 一句话定位
  └ 一句话自我介绍

─────────────────────────────────────
  关于我摘要（点 → /about）
  ├ 200 字以内
  └ 当前在做什么 / 关注什么 / 在找工作

─────────────────────────────────────
  最新文章 × 5
  ├ 标题 + 简介 + 日期 + 分类标签
  └ "查看全部 →" 跳 /blog

─────────────────────────────────────
  4 个分类卡片
  ├ 前端（X 篇）   → /blog/frontend
  ├ 后端（X 篇）   → /blog/backend
  ├ 数据库（X 篇） → /blog/database
  └ AI（X 篇）     → /blog/ai

─────────────────────────────────────
  Footer：邮箱 / GitHub / 简历链接
```

## 7. 部署流程

```
本地写 .md → git push → GitHub Actions → Astro build → 推到 gh-pages 分支 → 生效
```

`deploy.yml` 用 `withastro/action@v3`，触发条件 `push to main`。

## 8. 分阶段开发节奏

| 阶段 | 交付物 | 状态 |
|---|---|---|
| P0 | Astro 脚手架 + 依赖装好 | ✅ 完成（2026-07-04） |
| P1 | 骨架：Nav + Footer + 4 个分类页占位 + about 占位 | 待开始 |
| P2 | /skill frontend-design → 出设计稿 → 用户确认 → 写 CSS | 待开始 |
| P3 | Content Collection + 写 1 篇示例 .md → 验证全链路 | 待开始 |
| P4 | 真实文章录入 + 完善 about 页 | 持续 |

## 9. 待办 / 风险

1. **GitHub 用户名 ≠ lenvov**：实际是 `Exist-a`（SSH 测试发现），URL 应为 `exist-a.github.io`，规划文档待同步修正。
2. **GitHub 仓库未建**：等 P4 阶段再手动建仓 + 配 SSH key（已通，gh CLI 未登）。
3. **首页"关于我摘要"和 `/about` 页内容**：现在放 placeholder，等 P4 阶段再补真实内容。

## 10. 环境记录

- Node v24.14.1
- npm 11.5.2
- bash: D:\Git\bin\bash.exe（HERMES_GIT_BASH_PATH 已设）
- gh CLI 2.95.0 已装但未登录；SSH 直连可用
- Windows 11 + Python 3.12.6