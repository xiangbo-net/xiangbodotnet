/**
 * Pages Function —— /api/baby/*
 *
 * Cloudflare Pages 会自动把仓库根目录 functions/ 下的文件按路径路由成接口。
 * 本文件只做「薄适配层」：把请求转交给 baby/renzi/worker/api.js 里既有的
 * handleApi，保证线上（Pages Function）与本地（wrangler dev）跑的是同一份后端逻辑。
 *
 * 前端调用示例：
 *   GET  /api/baby/bootstrap
 *   POST /api/baby/round
 *   POST /api/baby/admin/login   …
 *
 * 依赖：Pages 项目里名为 DB 的 D1 绑定（hanzi-baby）。
 */
import { handleApi, CORS_HEADERS } from '../../../baby/renzi/worker/api.js';

export async function onRequest(context) {
  const { request, env } = context;

  // 跨域预检
  if (request.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: CORS_HEADERS });
  }

  const url = new URL(request.url);
  const res = await handleApi(request, env, url);

  const headers = new Headers(res.headers);
  for (const k of Object.keys(CORS_HEADERS)) headers.set(k, CORS_HEADERS[k]);
  return new Response(res.body, { status: res.status, statusText: res.statusText, headers });
}
