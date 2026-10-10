#!/usr/bin/env node
/**
 * build-frontend.cjs —— 把 src/ 下的模板 + 样式 + 逻辑合并成两个可发布的单文件页面
 *
 * 产物：
 *   baby/index.html   孩子端（认字闯关）
 *   baby/admin.html   家长端（字库管理）
 *
 * 用法：
 *   node tools/build-frontend.cjs                       # API 用相对路径 /api/baby（生产）
 *   node tools/build-frontend.cjs --api http://127.0.0.1:8787/api/baby   # 本地联调
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const read = p => fs.readFileSync(path.join(ROOT, p), 'utf8');

const argv = process.argv.slice(2);
let apiBase = '/api/baby';
for (let i = 0; i < argv.length; i++) {
  if (argv[i] === '--api' && argv[i + 1]) { apiBase = argv[i + 1]; i++; }
}

const outDir = path.join(ROOT, 'baby');
fs.mkdirSync(outDir, { recursive: true });

const PAGES = [
  { name: 'index.html', tpl: 'src/kid.template.html', css: 'src/kid.css', js: 'src/kid.js', label: '孩子端' },
  { name: 'admin.html', tpl: 'src/admin.template.html', css: 'src/admin.css', js: 'src/admin.js', label: '家长端' },
];

const problems = [];
const report = [];

for (const p of PAGES) {
  const tpl = read(p.tpl);
  const css = read(p.css);
  const js = read(p.js);
  const apiLiteral = JSON.stringify(apiBase);

  const out = tpl
    .replace('/*__CSS__*/', () => css)
    .replace('/*__API__*/', () => apiLiteral)
    .replace('/*__JS__*/', () => js);

  ['__CSS__', '__API__', '__JS__'].forEach(k => {
    if (out.includes('/*' + k + '*/')) problems.push(p.name + '：占位符未替换 ' + k);
  });
  if ((js.match(/<\/script/gi) || []).length) problems.push(p.name + '：JS 中出现 </script，会截断脚本');

  const file = path.join(outDir, p.name);
  fs.writeFileSync(file, out);
  report.push('  ' + p.label + '  ' + p.name.padEnd(12) + (Buffer.byteLength(out) / 1024).toFixed(1) + ' KB');
}

console.log('产物目录：' + outDir);
report.forEach(l => console.log(l));
console.log('API 基址：' + apiBase);
console.log(problems.length ? '❌ 自检问题：\n   - ' + problems.join('\n   - ') : '✅ 自检通过（占位符已替换 / 无脚本截断风险）');
process.exit(problems.length ? 1 : 0);
