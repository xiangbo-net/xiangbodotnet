#!/usr/bin/env node
/**
 * build-app.cjs — 把 CSS / 字表数据 / JS 合并成一个离线可用的单文件 HTML
 * 产物：汉字小侦探.html（双击即用，无需联网、无任何外部依赖）
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const read = p => fs.readFileSync(path.join(ROOT, p), 'utf8');

const tpl = read('src/index.template.html');
const css = read('src/app.css');
const js = read('src/app.js');
const data = read('src/hanzi.json');

const out = tpl
  .replace('/*__CSS__*/', () => css)
  .replace('/*__DATA__*/', () => data)
  .replace('/*__JS__*/', () => js);

const outFile = path.join(ROOT, '汉字小侦探.html');
fs.writeFileSync(outFile, out);

// 同时输出一份 index.html：GitHub Pages 根路径可直接打开（手机访问链接不用带中文文件名）
fs.writeFileSync(path.join(ROOT, 'index.html'), out);

// 自检：避免把注释占位符残留、避免出现 </script> 意外截断
const problems = [];
['__CSS__', '__DATA__', '__JS__'].forEach(k => { if (out.includes('/*' + k + '*/')) problems.push('占位符未替换：' + k); });
if ((js.match(/<\/script/gi) || []).length) problems.push('JS 中出现 </script，会截断脚本');
const kb = (Buffer.byteLength(out) / 1024).toFixed(1);

console.log('产物：' + outFile);
console.log('大小：' + kb + ' KB');
console.log('内嵌字表：' + JSON.parse(data).groups.reduce((a, g) => a + g.chars.length, 0) + ' 字');
console.log(problems.length ? '❌ 自检问题：\n   - ' + problems.join('\n   - ') : '✅ 自检通过（占位符已替换 / 无脚本截断风险）');
