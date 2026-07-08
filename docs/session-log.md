# 本次会话记录（2026-07-04）

## 决策时间线

1. **任务目标**：产出一个个人博客静态页面 → 部署到 GitHub Pages，工作目录 `D:\源码\exist-blog`
2. **下载 skill**：
   - 用户说"下载 front-design skill"，本地没有这个名字
   - 搜索后发现是 `frontend-design`（少打了 end），Anthropic 官方 skill
   - 在 `C:\Users\LENVOV\.claude\skills\frontend-design\` 找到（Trae IDE 下载过）
   - 复制到 `D:\hermes\skills\frontend-design\`，Hermes 已识别
3. **页面规划**：4 类博客（前端/后端/数据库/AI）+ 个人简介
4. **内容管理**：手写 .md 提交到 git（最简单起步）
5. **技术栈**：Astro（用户采纳推荐）
6. **域名**：暂用 github.io 子域，独立域名以后考虑
7. **视觉风格**：交给 frontend-design skill 决定（不脑补）
8. **GitHub 连接**：
   - gh CLI 已装但未登录
   - gh auth login --web 走不通（PTY 模拟限制）
   - 改走 SSH：发现机器上有 `D:\Git\bin\bash.exe`，但 HERMES_GIT_BASH_PATH 未设
   - 用户手动添加用户环境变量后，bash 探测修好
   - SSH 测试通：用户 `Exist-a`（不是 lenvov）
9. **P0 启动**：npm install Astro 装好（290 包，27 秒）

## 踩过的坑（避免重复）

1. **`npm install` 在前台 terminal 跑会被截断**：
   - Hermes terminal 工具输出 50KB 上限 + 长任务机制
   - 正确做法：`background=true + notify_on_complete=true + --loglevel=error`
   - 不要前台跑大依赖安装
2. **`setx` 命令会卡死**：写环境变量不要用 setx，用注册表（但当前会话不可见，需重启 session）或手动 GUI 加
3. **`gh auth login --web` 在 PTY 模拟下走不通**：promptui 要 \r，工具发 \n 进不到 PTY。改用 SSH 直连绕开
4. **read_file 对 `.claude` 这种点开头路径报"找不到"**：用 execute_code + open() 绕过
5. **tool `terminal` 探测 bash 失败时**：用 execute_code + Python 走网络/文件系统，不要硬走 terminal

## 待办（留给后续会话）

1. 规划文档里 GitHub 用户名是 `lenvov` 占位，需要改成 `Exist-a`
2. P1 阶段：搭骨架（Nav + Footer + 4 分类页占位 + about 占位）
3. P2 阶段：触发 frontend-design skill 出设计稿
4. P3 阶段：接 Content Collections + 写示例 .md
5. P4 阶段：手动建 GitHub 仓 + 推代码 + 配 Actions 部署