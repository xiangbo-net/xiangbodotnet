# 汉字小侦探 v2 · 认字小应用

4 岁孩子（沫沫）的汉字认字量测试。孩子端闯关认字，家长端维护字库，数据存在 Cloudflare D1。

- 孩子端：<https://xiangbo.net/baby/renzi/>
- 家长端：<https://xiangbo.net/baby/renzi/admin.html>

## 目录说明

| 路径 | 说明 |
| --- | --- |
| `index.html` | 孩子端（构建产物，单文件，含全部 CSS/JS） |
| `admin.html` | 家长端（构建产物，单文件） |
| `src/` | 源码：模板 + 样式 + 逻辑 |
| `tools/` | 构建与测试脚本 |
| `worker/` | 后端源码，由仓库根 `functions/api/baby/[[path]].js` 复用 |

本目录是**发布布局**：构建产物 `src/*` 合并后的单文件直接放在本目录根下。

后端不在本目录运行 —— 接口由仓库根的 Pages Function（`functions/api/baby/[[path]].js`）
挂载，它 import 本目录的 `worker/api.js`，共用同一份逻辑与 D1 绑定。

## 常用操作

```bash
# 重新构建两个单文件页面（产物落到本目录）
node tools/build-frontend.cjs

# 本地起服务联调（在项目工作副本里跑，非本目录）
npx wrangler dev --port 8787 --local

# 灌库
npx wrangler d1 execute hanzi-baby --remote --file worker/schema.sql
npx wrangler d1 execute hanzi-baby --remote --file worker/seed.sql

# 回归测试
node tools/apitest.cjs    # 后端接口断言
node tools/e2e.cjs        # 前端无头实测（需先起本地服务）
```

## 数据

Cloudflare D1 数据库 `hanzi-baby`，四张表：`chars`（字库 + 难度分）、`progress`（掌握状态）、
`sessions`（对局记录）、`settings`（口令 / 令牌）。

家长端初始口令**不写进本仓库**——本目录是公开发布目录，其中所有内容任何人都能直接访问。
初始口令只保存在本地源项目的部署说明里；首次登录后请在「设置」里立即修改。

## 刻意不放进公开仓库的文件

以下文件只保留在本地源项目里（构建 / 验证时用），因为含口令相关内容或会生成口令：

- `worker/seed.sql` —— 灌库脚本，内含初始口令的哈希（可用 `node tools/build-seed.cjs` 重新生成）
- `tools/onlinetest.cjs` —— 线上端到端验证脚本（请求体里带口令）
- `tools/liveshot.cjs` —— 线上站点截图脚本（登录要用口令）

仓库内保留的测试脚本（`tools/` 下的 `.cjs`）一律**不写死口令**，运行时按顺序取值：

1. 环境变量 —— 一般脚本用 `ADMIN_PASSWORD`，灌库脚本用 `SEED_PASSWORD`
2. 本地文件 `tools/.adminpw`（已加入 `.gitignore`，不会提交）

```bash
ADMIN_PASSWORD=你的口令 node tools/apitest.cjs
# 或者把口令放进本地文件，之后无需再传
printf '%s' '你的口令' > tools/.adminpw
```
