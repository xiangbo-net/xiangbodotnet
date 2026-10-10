/**
 * index.js —— Worker 入口
 *
 * 一个 Worker 同时承担两件事：
 *   1) /api/baby/*  → 交给 api.js 处理（后端接口）
 *   2) 其他一切请求 → 交给静态资源（env.ASSETS），行为与原来完全一致
 *
 * 这样既能挂进 xiangbo-net 站点，又不会改动任何现有页面的行为。
 */
import { handleApi, CORS_HEADERS } from './api.js';

function withCors(res) {
  const h = new Headers(res.headers);
  for (const k of Object.keys(CORS_HEADERS)) h.set(k, CORS_HEADERS[k]);
  return new Response(res.body, { status: res.status, statusText: res.statusText, headers: h });
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    // 跨域预检
    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: CORS_HEADERS });
    }

    // 后端接口
    if (url.pathname === '/api/baby' || url.pathname.startsWith('/api/baby/')) {
      return withCors(await handleApi(request, env, url));
    }

    // 静态资源（Cloudflare Workers Static Assets 绑定）
    if (env.ASSETS && typeof env.ASSETS.fetch === 'function') {
      return env.ASSETS.fetch(request);
    }
    return new Response('Not Found', { status: 404, headers: { 'Content-Type': 'text/plain; charset=utf-8' } });
  },
};
