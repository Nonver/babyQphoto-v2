#!/usr/bin/env node
/**
 * 洛克农场 —— 微信小程序 一键编译
 * ============================================================
 * 复用本机 HBuilderX 自带的 uni-app(vue3) 编译链，不需要 npm install 项目依赖，
 * 也不会改动 HBuilderX 安装目录（只在本项目 .workbuddy/hxroot 下建软链接）。
 *
 * 用法：
 *   node build-mp-weixin.mjs
 *
 * 产物：unpackage/dist/build/mp-weixin
 *   用「微信开发者工具」导入该目录即可预览 / 上传。
 * ============================================================
 */
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const PROJECT = path.resolve(path.dirname(fileURLToPath(import.meta.url)));
const HXROOT = path.join(PROJECT, '.workbuddy', 'hxroot');
const HX_PLUGINS = path.join(HXROOT, 'plugins');
const OUT_DIR = path.join(PROJECT, 'unpackage', 'dist', 'build', 'mp-weixin');
const SASS_VER = '1.77.8';

const log = (...a) => console.log(...a);

/* ---------- 1. 定位 HBuilderX ---------- */
function findHBuilderX() {
  const marker = path.join('plugins', 'uniapp-cli-vite', 'node_modules', '@dcloudio', 'vite-plugin-uni', 'bin', 'uni.js');
  const cands = [
    process.env.HX_PATH,
    process.env.HX_APP_ROOT,
    'E:/HBuilderX',
    'D:/HBuilderX',
    'F:/HBuilderX',
    'C:/HBuilderX',
    'C:/Program Files/HBuilderX',
    'C:/Program Files (x86)/HBuilderX',
  ].filter(Boolean);
  for (const c of cands) {
    try { if (fs.existsSync(path.join(c, marker))) return path.resolve(c); } catch { /* ignore */ }
  }
  return null;
}

const HX = findHBuilderX();
if (!HX) {
  log('✗ 没找到 HBuilderX（需要它自带的 uni-app 编译链）。');
  log('  请安装 HBuilderX，或设置环境变量 HX_PATH 指向安装目录，例如：');
  log('      set HX_PATH=D:\\HBuilderX');
  process.exit(1);
}
log(`✔ HBuilderX：${HX}`);

const UNI_JS = path.join(HX_PLUGINS, 'uniapp-cli-vite', 'node_modules', '@dcloudio', 'vite-plugin-uni', 'bin', 'uni.js');

/* ---------- 2. 准备隔离插件根 ---------- */
fs.mkdirSync(HX_PLUGINS, { recursive: true });

// 2.1 软链接 HBuilderX 的全部插件（compile-dart-sass 除外，我们自建）
const SRC_PLUGINS = path.join(HX, 'plugins');
let linked = 0;
for (const e of fs.readdirSync(SRC_PLUGINS, { withFileTypes: true })) {
  if (!e.isDirectory()) continue;
  if (e.name === 'compile-dart-sass') continue;
  const dst = path.join(HX_PLUGINS, e.name);
  if (fs.existsSync(dst)) continue;
  try { fs.symlinkSync(path.join(SRC_PLUGINS, e.name), dst, 'junction'); linked++; } catch { /* ignore */ }
}
if (linked) log(`✔ 已映射 ${linked} 个 HBuilderX 插件（软链接）`);

// 2.2 dart-sass（HBuilderX 默认不带，需自备；仅 App.vue 用了 scss）
const sassPkg = path.join(HX_PLUGINS, 'compile-dart-sass', 'node_modules', 'sass', 'package.json');
if (!fs.existsSync(sassPkg)) {
  log(`· 首次运行需要安装 dart-sass@${SASS_VER} …`);
  const sassDir = path.join(HX_PLUGINS, 'compile-dart-sass');
  fs.mkdirSync(sassDir, { recursive: true });
  fs.writeFileSync(path.join(sassDir, 'package.json'),
    JSON.stringify({ name: 'compile-dart-sass', version: '1.0.0', private: true }, null, 2), 'utf8');
  const npmCmd = process.platform === 'win32' ? 'npm.cmd' : 'npm';
  const r = spawnSync(npmCmd, ['install', `sass@${SASS_VER}`, '--no-audit', '--no-fund', '--loglevel=error'],
    { cwd: sassDir, stdio: 'inherit', shell: process.platform === 'win32' });
  if (r.status !== 0 || !fs.existsSync(sassPkg)) {
    log('✗ dart-sass 安装失败。可在有网的机器上手动执行：');
    log(`      cd "${sassDir}" && npm install sass@${SASS_VER}`);
    process.exit(1);
  }
}
log('✔ dart-sass 就绪');

/* ---------- 3. 执行编译 ---------- */
log('');
log('开始编译微信小程序 …');
log('');

const env = {
  ...process.env,
  HX_APP_ROOT: HXROOT,                 // 让 uni 认为自己在 HBuilderX 内，从而使用其编译链
  UNI_INPUT_DIR: PROJECT,              // 本项目根即源码目录（HBuilderX 工程结构）
  UNI_OUTPUT_DIR: OUT_DIR,
  UNI_PLATFORM: 'mp-weixin',
  NODE_ENV: 'production',
};

const r = spawnSync(process.execPath, [UNI_JS, 'build', '-p', 'mp-weixin'], {
  cwd: PROJECT, env, stdio: 'inherit',
});

if (r.status !== 0) {
  log('');
  log('✗ 编译失败，退出码 ' + r.status);
  process.exit(r.status ?? 1);
}

/* ---------- 4. 结果核对 ---------- */
const must = [
  'app.js', 'app.json', 'app.wxss', 'project.config.json',
  'pages/douyin/douyin.wxml', 'pages/power-query/power-query.wxml', 'pages/hero-list/hero-list.wxml',
];
const miss = must.filter((f) => !fs.existsSync(path.join(OUT_DIR, f)));
log('');
log('─────────────────────────────────────────────');
if (miss.length) {
  log('⚠ 编译完成，但缺少文件：' + miss.join(', '));
} else {
  log('✅ 编译完成，关键文件齐全');
}
log('   产物目录：' + OUT_DIR);
log('   下一步：微信开发者工具 → 导入项目 → 选择上面的目录');
log('   （AppID 已在 manifest.json 中：wx727a9e58496c2012）');
log('─────────────────────────────────────────────');
