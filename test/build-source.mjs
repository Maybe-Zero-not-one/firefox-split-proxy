/**
 * 打 AMO 的「源码包」：把 src/ + test/ + BUILD.md + README.md + LICENSE 打成一个 zip。
 *
 * 为什么要单独打：AMO 在「是否提交源代码」那步选「是」时会要一个源码 zip。
 * 我们的扩展没有构建步骤（提交的 xpi 就是 src/ 原文），但审核表里那一栏还是能选「是」，
 * 所以按它的要求给一份完整、可复现、能自己跑出同样 xpi 的源码包最省事。
 *
 * 包里不放 dist/（那是产物）、不放 node_modules（本来就没有）。
 */
import { promises as fs } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');
const DIST = path.join(ROOT, 'dist');

const version = JSON.parse(await fs.readFile(path.join(ROOT, 'src', 'manifest.json'), 'utf8')).version;
const out = path.join(DIST, `split-proxy-${version}-source.zip`);

// 源码包要包含什么：能据此复现出 xpi 的最小充分集
const INCLUDE = [
  'src',
  'test',
  'BUILD.md',
  'README.md',
  'LICENSE',
  'AMO-SUBMISSION.md',
  '.gitignore',
  '.gitattributes',
];

await fs.mkdir(DIST, { recursive: true });

// 先拷到一个扁平暂存目录，保持包内路径就是 <name>/...
const stage = path.join(DIST, `.stage-source-${Date.now()}`);
await fs.mkdir(stage, { recursive: true });
for (const name of INCLUDE) {
  const from = path.join(ROOT, name);
  const to = path.join(stage, name);
  try {
    await fs.cp(from, to, { recursive: true });
  } catch {
    // 可选文件不存在就跳过（比如 .gitignore）
  }
}

const tmp = path.join(DIST, `.tmp-src-${Date.now()}.zip`);
const q = (s) => s.replace(/'/g, "''");

// 注意：CreateFromDirectory 在 Windows 上会把 entry 名写成反斜杠（src\bg.js）。
// zip 规范要求正斜杠，AMO 那边按规范解析。所以这里逐个文件手动加 entry，
// 名字统一把 \ 换成 /。
const walk = async (dir, base = '') => {
  const rows = [];
  for (const e of await fs.readdir(dir, { withFileTypes: true })) {
    const rel = base ? `${base}/${e.name}` : e.name;
    const full = path.join(dir, e.name);
    if (e.isDirectory()) rows.push(...(await walk(full, rel)));
    else rows.push({ rel, full });
  }
  return rows;
};
const files = await walk(stage);
const ps = `
Add-Type -AssemblyName System.IO.Compression.FileSystem
if (Test-Path '${q(tmp)}') { Remove-Item '${q(tmp)}' -Force }
$zip = [System.IO.Compression.ZipFile]::Open('${q(tmp)}', 'Create')
try {
${files.map((f) => `  [System.IO.Compression.ZipFileExtensions]::CreateEntryFromFile($zip, '${q(f.full)}', '${q(f.rel)}') | Out-Null`).join('\n')}
} finally { $zip.Dispose() }
`;
const r = spawnSync('powershell', ['-NoProfile', '-Command', ps], { encoding: 'utf8' });
await fs.rm(stage, { recursive: true, force: true });
if (r.status !== 0) {
  console.error('打包失败：', r.stderr || r.stdout);
  process.exit(1);
}
await fs.rm(out, { force: true });
await fs.rename(tmp, out);

const st = await fs.stat(out);
console.log(`✅ ${path.relative(process.cwd(), out)}  ${(st.size / 1024).toFixed(1)} KB`);

const list = spawnSync('powershell', ['-NoProfile', '-Command',
  `Add-Type -AssemblyName System.IO.Compression.FileSystem
   [System.IO.Compression.ZipFile]::OpenRead('${q(out)}').Entries | ForEach-Object { $_.FullName }`],
{ encoding: 'utf8' });
console.log('\n包内容：');
console.log(list.stdout.trim());
