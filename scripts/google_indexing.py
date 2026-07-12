#!/usr/bin/env python3
"""
submit_urls.py — 读取 dist/sitemap-0.xml，逐个调用 Google Indexing API 推送。

设计要点：
- 不做 batch，每 URL 单独 publish，每天 200 的配额个人博客远够用
- 单 URL 失败不影响其它 URL，最后统计成功 / 失败数
- 从 3 个拆开的 env 字段（GOOGLE_PROJECT_ID / GOOGLE_CLIENT_EMAIL /
  GOOGLE_PRIVATE_KEY）拼出 service_account blob，避 GitHub Secrets 粘整段
  JSON 不便，以及一些浏览器对多行 PRIVATE_KEY 丢换行的坑
"""

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

    # 调试用：打印 env 状态（不含真实内容，只含长度/换行数），
    # key 不打任何字符，避免意外进公开仓库的日志。
    print("[env] ----- credential env state -----")
    for k in ["GOOGLE_PROJECT_ID", "GOOGLE_CLIENT_EMAIL", "GOOGLE_PRIVATE_KEY"]:
        v = os.environ.get(k)
        if not v:
            print(f"[env] {k} = EMPTY")
        else:
            print(f"[env] {k} set, len={len(v)}, newlines={v.count(chr(10))}")
    print("[env] ---------------------------------")

    missing = [k for k in required if not os.environ.get(k)]
    if missing:
        print(f"ERROR: missing env var(s): {', '.join(missing)}", file=sys.stderr)
        return 1

    urls = extract_urls(SITEMAP_PATH)
    print(f"Sitemap contains {len(urls)} URL(s).")
    if not urls:
        return 0

    # GitHub Secrets UI 不便粘整段 JSON，
    # 因此在 CI 上从 3 个拆开的 env 字段重组 service account blob。
    # google-auth 库只用以下字段，其它元数据 OAuth 流程会自动填充。
    creds_dict = {
        "type": "service_account",
        "project_id": os.environ["GOOGLE_PROJECT_ID"],
        "private_key_id": os.environ.get("GOOGLE_PRIVATE_KEY_ID", ""),
        "private_key": os.environ["GOOGLE_PRIVATE_KEY"],
        "client_email": os.environ["GOOGLE_CLIENT_EMAIL"],
        "client_id": os.environ.get("GOOGLE_CLIENT_ID", ""),
    }
    try:
        credentials = service_account.Credentials.from_service_account_info(
            creds_dict, scopes=SCOPES
        )
    except Exception as e:
        print(f"ERROR building credentials: {type(e).__name__}: {e}",
              file=sys.stderr)
        return 1
    service = build("indexing", "v3", credentials=credentials, cache_discovery=False)

    ok = 0
    err = 0
    for url in urls:
        success, msg = submit_url(service, url)
        if success:
            ok += 1
            print(f"  OK   {url}")
        else:
            err += 1
            print(f"  ERR  {url}  ->  {msg}")

    print(f"\nDone. OK={ok}  ERR={err}")
    # 部分失败仍然让 workflow 标绿（个人站不必因一条失败红屏）
    return 0


if __name__ == "__main__":
    sys.exit(main())
