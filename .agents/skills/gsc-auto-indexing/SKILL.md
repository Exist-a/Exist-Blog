---
name: gsc-auto-indexing
description: 当用户想把静态博客站点的新文章自动推送给 Google 收录时使用此 skill。覆盖 GSC 资源验证、Site Verification HTML 文件、sitemap 自动生成、Google Indexing API 自动化推送的整套流程，让 push → Google 收录全自动，无需手动在 GSC 点「请求编入索引」。
---

# Google 自动收录：静态博客接 Google Indexing API

## 何时使用

- 你的项目是静态博客（GitHub Pages / Cloudflare Pages / Netlify / Vercel Static 等），部署工具链里已有 CI（如 GitHub Actions）
- 你已经在 GSC 添加并验证了资源
- 你希望**每次 push 到 main 后新文章立即被 Google 收录**，不想再手动到 GSC 点提交
- 你已经（或愿意）拥有 sitemap 自动生成能力

## 不适用

- 还没在 GSC 验证资源：先完成「添加资源」+「所有权验证」再来用
- 服务端 SSR / Next.js ISR 站点：自己已经有 API 钩子，不需要这套
- 每天产生几百篇文章以上的站点：Indexing API 配额 200 / 天不够

---

## 背景：为什么 GSC UI「请求编入索引」不行

- 每天只能手动操作 10–12 条 URL
- GSC 没提供「批量提交」UI
- 自动化方案：Google Indexing API（v3）—— push（`URL_UPDATED`）即可通知 Google 立刻抓取
- 官方口径：只服务 `JobPosting` 和 `BroadcastEvent`；社区大量普通博客这么做，Google 并未封禁，**但有配额（200/天）**

## 三步一次性配置（一次性 10–15 分钟）

### 第 1 步：GSC 验证所有权

在 [Google Search Console](https://search.google.com/search-console) 添加资源，**优先选「网址前缀」而非「域名」**（带 base path 的项目只能用前缀或 HTML 文件方式）。

| 验证方式 | 适用场景 |
|---|---|
| HTML 标签 | 任何项目都能用，推荐 |
| HTML 文件 | 不便改模板时 |
| DNS TXT | 只能给独立域名用，github.io 子域名无权改 DNS |

如果用 HTML 文件：

- 在 `<head>` 加 `<meta name="google-site-verification" content="...">`，**或** 把 `google<hash>.html` 放到 `public/` 下让 Astro 一起部署
- 注意：GSC 添加「网址前缀」时如果带 base path（比如 `https://xxx.github.io/xxx-blog/`），HTML 文件验证能找到 `https://xxx.github.io/xxx-blog/google<hash>.html` ✅ 没问题

### 第 2 步：创建 Service Account + 启用 API

1. 进入 https://console.cloud.google.com/
2. 新建项目（叫什么都行，例如 `xxx-blog-indexing`）
3. 左侧「**API 和服务**」→「**库**」→ 搜索「Indexing API」→ 「**Web Search Indexing API**」→ 「**启用**」
4. 左侧「**IAM 和管理**」→「**服务账号**」→「**创建服务账号**」
   - 名称：`indexer`
   - 描述（可选）：`for Indexing API of xxx blog`
   - 跳过第 2/3 步权限与主账号配置，**直接创建并关闭**
5. 服务账号列表 → 该账号 → 行尾 `⋮` → 「**管理密钥**」→ 「**添加密钥**」→「**创建新密钥**」→「**JSON**」→ 下载

### 第 3 步：把 Service Account 加为 GSC 资源所有者

1. GSC → 资源 → 右上角「**设置**」→「**用户和权限**」→「**添加用户**」
2. 把刚下载的 JSON 文件里的 `client_email` 字段粘进去
3. 权限选「**所有者**」→ 添加

这一步不可省略：没有授权，API 调用会被拒。

---

## 项目侧改造

### 0. 保护凭证

在 `.gitignore` 加：

```gitignore
# Google service account credential (DOWNLOADED LOCALLY, NEVER commit)
exist-blog-*.json
*-credentials.json
sa-key.json
```

**永远不要把 JSON 文件 commit 进仓库**。本地用完即删，CI 走 `secrets.GOOGLE_CREDENTIALS_JSON`。

### 1. `scripts/google_indexing.py`

读 `dist/sitemap-0.xml`，逐个 URL 调 Indexing API，单 URL 失败不影响其他。

```python
#!/usr/bin/env python3
"""submit_urls.py — 读取 dist/sitemap-0.xml，逐个调用 Google Indexing API 推送。"""
import json
import os
import sys
import xml.etree.ElementTree as ET
from typing import List

from google.oauth2 import service_account
from googleapiclient.discovery import build
from googleapiclient.errors import HttpError

SITEMAP_PATH = "dist/sitemap-0.xml"
SCOPES = ["https://www.googleapis.com/auth/indexing"]
NS = "{http://www.sitemaps.org/schemas/sitemap/0.9}"


def extract_urls(sitemap_path: str) -> List[str]:
    if not os.path.exists(sitemap_path):
        print(f"ERROR: {sitemap_path} not found, run `npm run build` first.",
              file=sys.stderr)
        sys.exit(1)
    urls: List[str] = []
    tree = ET.parse(sitemap_path)
    for url in tree.getroot().findall(f"{NS}url"):
        loc = url.find(f"{NS}loc")
        if loc is not None and loc.text:
            urls.append(loc.text.strip())
    return urls


def submit_url(service, url: str) -> tuple[bool, str]:
    try:
        service.urlNotifications().publish(
            body={"url": url, "type": "URL_UPDATED"}
        ).execute()
        return True, ""
    except HttpError as e:
        return False, f"HTTP {e.resp.status}: {e._get_reason()}"
    except Exception as e:
        return False, repr(e)


def main() -> int:
    required = [
        "GOOGLE_PROJECT_ID",
        "GOOGLE_CLIENT_EMAIL",
        "GOOGLE_PRIVATE_KEY",
    ]
    missing = [k for k in required if not os.environ.get(k)]
    if missing:
        print(f"ERROR: missing env var(s): {', '.join(missing)}", file=sys.stderr)
        return 1

    urls = extract_urls(SITEMAP_PATH)
    print(f"Sitemap contains {len(urls)} URL(s).")
    if not urls:
        return 0

    # GitHub Secrets UI 粘整段 JSON 不便 / 部分浏览器会丢多行，
    # 因此从 3 个拆开的 env 字段重组 service account blob。
    # google-auth 库只用以下字段，其它 OAuth 元数据自动填充。
    creds_dict = {
        "type": "service_account",
        "project_id": os.environ["GOOGLE_PROJECT_ID"],
        "private_key_id": os.environ.get("GOOGLE_PRIVATE_KEY_ID", ""),
        "private_key": os.environ["GOOGLE_PRIVATE_KEY"],
        "client_email": os.environ["GOOGLE_CLIENT_EMAIL"],
        "client_id": os.environ.get("GOOGLE_CLIENT_ID", ""),
    }
    credentials = service_account.Credentials.from_service_account_info(
        creds_dict, scopes=SCOPES
    )
    service = build("indexing", "v3", credentials=credentials, cache_discovery=False)

    ok = err = 0
    for url in urls:
        success, msg = submit_url(service, url)
        if success:
            ok += 1
            print(f"  OK   {url}")
        else:
            err += 1
            print(f"  ERR  {url}  ->  {msg}")

    print(f"\nDone. OK={ok}  ERR={err}")
    return 0  # 部分失败不红屏


if __name__ == "__main__":
    sys.exit(main())
```

### 2. `.github/workflows/google-indexing.yml`

监听已有 deploy 工作流，**只在它成功完成后**触发。

```yaml
name: Google Indexing

on:
  workflow_run:
    workflows: ["Deploy to GitHub Pages"]   # 改成你的 deploy workflow 名
    types: [completed]

permissions:
  contents: read

concurrency:
  group: gsc-indexing
  cancel-in-progress: false

jobs:
  index:
    if: ${{ github.event.workflow_run.conclusion == 'success' }}
    runs-on: ubuntu-latest
    steps:
      - name: Checkout deploy commit
        uses: actions/checkout@v4
        with:
          ref: ${{ github.event.workflow_run.head_branch }}
          fetch-depth: 1

      - name: Setup Python
        uses: actions/setup-python@v5
        with:
          python-version: '3.x'

      - name: Setup Node
        uses: actions/setup-node@v4
        with:
          node-version: 22.12.0     # 与项目 .nvmrc / engines.node 对齐
          cache: npm

      - name: Install Python deps
        run: |
          python -m pip install --upgrade pip
          pip install google-api-python-client google-auth

      - name: Install JS deps & build
        run: npm install --no-audit --no-fund && npm run build

      - name: Submit URLs to Google Indexing API
        env:
          GOOGLE_PROJECT_ID: ${{ secrets.GOOGLE_PROJECT_ID }}
          GOOGLE_CLIENT_EMAIL: ${{ secrets.GOOGLE_CLIENT_EMAIL }}
          GOOGLE_PRIVATE_KEY: ${{ secrets.GOOGLE_PRIVATE_KEY }}
        run: python scripts/google_indexing.py
```

### 3. 注入 Secret（推荐拆 3 个字段）

GitHub 仓库 → **Settings** → **Secrets and variables** → **Actions** → **New repository secret**

| Name | Value |
|---|---|
| `GOOGLE_PROJECT_ID` | JSON 文件里的 `project_id`（如 `exist-blog`） |
| `GOOGLE_CLIENT_EMAIL` | JSON 文件里的 `client_email`（如 `indexer@xxx.iam.gserviceaccount.com`） |
| `GOOGLE_PRIVATE_KEY` | JSON 文件里的 `private_key` 整段，包含 `-----BEGIN/END PRIVATE KEY-----` 以及中间所有换行 |

> **为什么不用整段 JSON**：浏览器粘大段多行内容有时会丢换行（PRIVATE KEY 缺一行就失效）；拆字段更稳。如果坚持整段，往环境变量塞 `GOOGLE_CREDENTIALS_JSON`，把脚本里的 `required` 改回读单一字段并 `json.loads`。

---

## 验收

1. push 到 main → 触发 deploy → 完成后约 30s 触发 google-indexing
2. workflow 日志输出 `Done. OK=N  ERR=0` 或少量错误
3. 24 小时内在 GSC 左侧「**网页**」能看到新发布的文章状态变「**已编入索引**」
4. 也可以在 GSC 「**网址检查**」输入 URL 复测，会立刻显示「**已编入索引**」

---

## 注意事项 / 坑

- **配额 200/天**：超出返回 `HTTP 429`。站点 < 50 篇文章基本不会触发；多了就靠 sitemap 自动发现兜底（手动 push 仅做种子）
- **Service Account 必须加为 GSC 所有者**，否则 `permission denied`
- **Sitemap 没读取到**：多半是 build 没成功或路径配错；先在 workflow 里 debug `cat dist/sitemap-0.xml | head`
- **GitHub Pages 自定义 `base`**：所有 URL 拼接都是 `<site><base>/xxx`，sitemap 里的 loc 必须拼对了；Astro `@astrojs/sitemap` 自动处理好，但自定义 sitemap 要自己注意
- **失败后仍返回 0**（不红屏）：如果想严格模式，把 `return 0` 改成 `return 1 if err else 0`
- **页面真的存在但 API 报 404**：等几分钟重试；多见于 GitHub Pages CDN 缓存刚刷新的瞬间
- **不要把 JSON 凭证 commit 进仓库**，本地用完即删

---

## 与已有 Bing/Yandex 推送的协同

大部分项目同时还会用 IndexNow（覆盖 Bing / Yandex / Seznam），模式与本 skill 完全同构：

- 已有 `indexnow` job → 在 `deploy.yml` 末尾运行
- 新 `google-indexing.yml` → 独立 workflow、`workflow_run` 触发
- 两者互不影响，URL 列表都来自 `dist/sitemap-0.xml`

## 不要做的事

- 不要把 Service Account JSON **任何形式** commit
- 不要因为「GSC sitemap 显示无法抓取」就放弃 Indexing API——这俩是两套独立机制，sitemap 抓取失败不代表 Indexing API 不可用
- 不要在没有 Service Account 授权的情况下调 API
