---
name: blog-writing-style
description: 在本博客(exist-a.github.io/Exist-Blog)写新文章时,让模型按既定文风产出中文 Markdown 笔记。覆盖口语化对话式语气、不加中文引号、用加粗而非引号做强调、frontmatter 必填项(category/tags 必须与 src/data/posts.ts 对齐)、结构上「口语引入 → 分节展开 → 小结收尾」的节奏,以及图片/代码块的相对路径约定。适用场景:用户在 src/content/posts 下新建 .md 笔记、要求「按博客风格写一篇关于 X 的文章」、润色既有草稿时,先触发本 skill 取得文风约束再下笔。
---

# 博客文风约定(exist-blog)

> 本文是从 [src/content/posts/](file:///d:/exist-blog/src/content/posts/) 下既有的 6 篇文章里提炼出的写作约定,供后续写新文章时对齐。

## 何时使用

- 要在 `src/content/posts/<category>/<slug>.md` 新写一篇博客
- 用户口头说「按博客风格写一篇...」「润色一下这篇草稿」「让它跟现有文章一个味道」
- 旧文章里发现文风偏离(出现 emoji / 中文引号 / 学术腔),需要按本规范修正

## 不适用

- 写纯文档(README、设计文档)——本博客明确不写 README,见根目录 AGENTS.md
- 翻译、改写为其它语言
- 用户明确给出相反的文风要求时,以用户为准

---

## 1. 总基调

- **中文口语化 + 对话式叙述**,像在跟读者聊天,不是写论文
- **第一人称复数**:大量用「我们」「一起」「今天我们来一起看看...」「这一篇我们把它讲明白」
- **口头禅过渡**:「别急」「不急,我们慢慢来」「一看便知」「举个例子」「顾名思义」
- **不端架子**:可以下结论但不要说教;可以说「实际工程里更常用」但不要说「最佳实践推荐」
- **不要 emoji**——任何位置都不要,标题里也不要
- **不要主动加中文引号** —— 强调统一用 Markdown 加粗 `**xxx**`,不是 `""` / `「」`
- 不要堆砌过渡句、总结陈词;能用一句话讲清的不用三句

## 2. 开篇套路

样本里几乎每篇都是**先抛一句口语化引入**,再进入正题,而不是一上来甩定义:

| 套路 | 示例 |
|---|---|
| 现象引入 + 同感句 | 「对于 RAG 大家应该都不陌生,在目前的技术圈子里面十分火热,今天我们来一起看看 RAG 到底是个什么东西。」 |
| 反问/反直觉引入 | 「提到索引,我们想到的会是数据库的目录。可是,你想过没有,为什么它能像目录一样...」 |
| 一句定义 + 反问 | 「JS 是一门**基于原型的面向对象**语言。有些同学可能有点疑惑,什么是基于原型?别急,看完这篇就懂了。」 |
| 版本演进引入 | 「Vue3 把内部的 Diff 算法从 Vue2 的**双端 Diff** 换成了**快速 Diff**。这俩到底有啥区别?这一篇我们把它讲明白。」 |

避免一上来就「本文将介绍 X 的定义、原理、应用场景」(教科书式开头)。

## 3. frontmatter 必填

```yaml
---
title: ...
date: 2026-08-18   # 必须是当天真实日期,不要占位
excerpt: 一句话中文摘要 + 必要时括号补英文/全称
category: frontend | backend | database | ai   # 必须从 src/data/posts.ts 的 categories 取
tags: [javascript]   # 通常单 tag;tag slug 必须能在 src/data/posts.ts 的 subcategories[category] 里查到
---
```

- `category` / `tags` 是 schema 校验字段,拼错会构建失败
- 一篇文章**只放一个 tag**,除非用户明确允许多个
- slug 命名:全小写、连字符分隔、与主题强相关(如 `double-end-and-fast-diff` / `clustered-vs-nonclustered-index`)
- 标题中文为主,必要时保留英文术语(用加粗强调)

## 4. 正文结构

```
# 一级标题(与 frontmatter.title 一致)
[口语化开篇,2-4 段]

## 一、第一节标题
### 1.1 子节标题
### 1.2 子节标题
内容

## 二、第二节标题
...

## 小结
- 加粗短语开头的条目列表
```

- 章节标题喜欢用「一、二、三」序号;子节用「3.1、3.2」式小数编号
- 不强制必须有引言,但长文(> 5 节)建议在第一节前放一段「引言」式过渡
- **结尾必须有「小结」**,用 bullet 列表,每条以 `**加粗短语**` 开头概括一个核心点
- 偶有「> 一句话概括:xxx」块引用放在小结最上面,作为 TL;DR

## 5. 强调与术语

| 场景 | 用法 |
|---|---|
| 关键概念首次出现 | 中文译名 + 括号补英文缩写,如「**RAG**(Retrieval Augmented Generation,检索增强生成)」 |
| 重点短语 | `**xxx**` 加粗,不要用 `""` / `「」` |
| 引用术语原名 | 直接保留英文,如 `[[Prototype]]`、`__proto__`、`sync.Map`、`VNode`,用反引号 inline code 包裹 |
| API / 类型 / 文件名 | inline code:`sync.Mutex`、`Make(map)`、`public/googleb3d43f92716dd39c.html` |
| 中英混排 | 允许,不要刻意拆分;英文术语不译时直接用 |

## 6. 代码与图片

### 6.1 代码块

- 用 ``` 包裹,标注语言(html/js/go/sql/json/sh/text...)
- 注释**用中文**,贴近样本(对照 `map-vs-sync-map.md` 的中文注释)
- 简短示例 5–15 行即可;长代码拆成多段配讲解,不要堆一屏

### 6.2 图片

路径约定(看 [javascript-prototype-chain.md](file:///d:/exist-blog/src/content/posts/frontend/javascript-prototype-chain.md) ):

```markdown
# 同目录
![alt](image.png)

# 文章专属子目录(常见做法:同名文件夹)
![alt](./javascript-prototype-chain/triangle.jpeg)
```

- 一篇文章需要的图,放在 `src/content/posts/<category>/<slug>/` 子目录里,引用时加 `./<slug>/`
- 单张图(如 one-off 截图)可直接放与 .md 同目录
- 不要用绝对路径或 `/` 开头的根路径
- alt 文字用中文,简短描述图的内容

## 7. 引用、公式、表格

- 公式、长模板、核心定义 → 用 Markdown 引用块 `> ...` 包起来,与正文做视觉区分
  - 例:见 [what-is-rag.md](file:///d:/exist-blog/src/content/posts/ai/what-is-rag.md) 的 MMR 公式块
- 对比 / 步骤 → 用 Markdown 表格
  - 例:见 [double-end-and-fast-diff.md](file:///d:/exist-blog/src/content/posts/frontend/double-end-and-fast-diff.md) 的「四指针比较」表和「两者对比」表
- 长 bullet 列表 → 项内换行用 `1.` / `-` 有序/无序都可,层级最多两层

## 8. 事实核查与软化措辞

- 完成初稿后**主动检查术语拼写**(历史反例:`Execute-and-Plan` 应为 `Plan-and-Execute`)
- 不确定出处的具体数字,**软化措辞**或加「因模型/任务而异」之类的限定,不要硬给百分比
- 出处不明的引用,要么给出具体链接(优先),要么去掉,不要凭空挂「研究表明」「业界共识」

## 9. 修改既有草稿的偏好

- 「不要改动太多」是默认偏好——只修错别字、转义字符(`\-`、转义省略号)、不通顺的句子
- 结构、用词、段落顺序尽量保留原貌
- 涉及改动较大时,**主动询问**而不是直接大改

## 10. 不要做的事(再次强调)

- 不写 README / 文档类 `.md`(AGENTS.md 例外)
- 不加 emoji
- 不在内容里加中文引号 `""` `「」`(除非确需引用一段原文)
- 不堆砌过渡句 / 总结陈词
- 不主动 commit / push——改完后等用户审查

---

## 11. 一页式写作 checklist

写完一篇,自检下面几项:

- [ ] frontmatter 字段全齐,`category` / `tags` 在 `src/data/posts.ts` 能查到
- [ ] `date` 是当天真实日期
- [ ] 标题、口吻与样本一致(口语化、第一人称、没 emoji、没中文引号)
- [ ] 重点概念首次出现有中英对照
- [ ] 代码块标注了语言,注释用中文
- [ ] 图片路径是相对 `./<slug>/` 或同目录
- [ ] 结尾有「小结」段,bullet 用 `**加粗短语**` 开头
- [ ] 没有「执行了 commit」「加了 README」「加了 emoji」类越界动作
