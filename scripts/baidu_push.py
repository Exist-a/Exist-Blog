#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
baidu_push.py —— 百度搜索资源平台"普通收录"工具：API 主动推送。

读 dist/sitemap-0.xml → 提取所有 URL → POST 到百度 API。
无需鉴权（只需要 site + token）。

环境变量：
  BAIDU_SITE   - 站点 URL，如 https://exist-a.github.io/Exist-Blog
  BAIDU_TOKEN  - 百度站长平台推送 token

文档：
  https://ziyuan.baidu.com/college/courseinfo?id=267&page=2
"""

import os
import re
import sys
import json
import urllib.request
import urllib.parse
import urllib.error
from pathlib import Path

# 与 deploy.yml / google-indexing.yml 保持一致：单 URL 失败不红屏
PUSH_URL = 'http://data.zz.baidu.com/urls'


def get_env(name: str) -> str:
    val = os.environ.get(name, '').strip()
    if not val:
        print(f'[env] missing required env var: {name}', file=sys.stderr)
        sys.exit(1)
    return val


def parse_sitemap(sitemap_path: Path) -> list[str]:
    """从 sitemap-0.xml 里抽取所有 <loc>...</loc>。"""
    if not sitemap_path.exists():
        print(f'[sitemap] not found: {sitemap_path}', file=sys.stderr)
        return []
    txt = sitemap_path.read_text(encoding='utf-8')
    return re.findall(r'<loc>([^<]+)</loc>', txt)


def push(urls: list[str], site: str, token: str) -> tuple[int, int]:
    """调百度 API，返回 (ok_count, err_count)。"""
    if not urls:
        return (0, 0)

    body = '\n'.join(urls).encode('utf-8')
    qs = urllib.parse.urlencode({'site': site, 'token': token})
    full_url = f'{PUSH_URL}?{qs}'

    req = urllib.request.Request(
        full_url,
        data=body,
        headers={'Content-Type': 'text/plain'},
        method='POST',
    )

    ok = 0
    err = 0
    try:
        with urllib.request.urlopen(req, timeout=30) as resp:
            raw = resp.read().decode('utf-8', errors='replace')
            try:
                data = json.loads(raw)
                # success 是剩余配额；remain 是当天剩余
                print(f'[baidu] response: {data}')
                # 当 batch 推送时，整体成功 = ok
                if data.get('success'):
                    ok = len(urls)
                elif isinstance(data.get('success'), int):
                    ok = data['success']
                if data.get('error'):
                    print(f'[baidu] error: {data["error"]}', file=sys.stderr)
                    err = len(urls) - ok
            except json.JSONDecodeError:
                print(f'[baidu] non-json response: {raw}', file=sys.stderr)
                # HTTP 200 但无法解析 → 保守按成功处理
                ok = len(urls)
    except urllib.error.HTTPError as e:
        print(f'[baidu] HTTP error: {e.code} {e.reason}', file=sys.stderr)
        try:
            print(f'[baidu] body: {e.read().decode("utf-8", errors="replace")}',
                  file=sys.stderr)
        except Exception:
            pass
        err = len(urls)
    except Exception as e:
        print(f'[baidu] unexpected error: {e!r}', file=sys.stderr)
        err = len(urls)

    return (ok, err)


def main():
    site = get_env('BAIDU_SITE')
    token = get_env('BAIDU_TOKEN')

    sitemap_path = Path('dist') / 'sitemap-0.xml'
    urls = parse_sitemap(sitemap_path)
    print(f'[sitemap] {len(urls)} URL(s) parsed from {sitemap_path}')

    if not urls:
        print('[baidu] nothing to push, skip')
        return

    ok, err = push(urls, site, token)
    print(f'[baidu] OK={ok} ERR={err} TOTAL={len(urls)}')
    # 与 google_indexing.py 风格一致：单条失败不红屏，
    # 个人博客没必要因为偶发 429 / 网络抖动让 CI 红
    if err and not ok:
        sys.exit(1)


if __name__ == '__main__':
    main()
