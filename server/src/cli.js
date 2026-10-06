/**
 * 命令行解析工具
 *   node src/cli.js "抖音分享文案或链接"
 */
import { parse } from './parser.js';

const input = process.argv.slice(2).join(' ').trim();
if (!input) {
  console.log('用法: node src/cli.js "抖音分享文案或链接"');
  process.exit(1);
}

const t = Date.now();
try {
  const data = await parse(input);
  console.log(JSON.stringify(data, null, 2));
  console.log(`\n⏱  耗时 ${Date.now() - t}ms`);
} catch (e) {
  console.error('❌ 解析失败:', e.code || '', e.message);
  process.exitCode = 1;
}
