/**
 * 打包成 .xpi（就是改名后的 zip）。
 * Firefox 装本地未签名扩展需要 xpinstall.signatures.required=false，
 * 见 README 里的两种安装方式。
 */
import { promises as fs } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SRC = path.resolve(HERE, '..', 'src');
const DIST = path.resolve(HERE, '..', 'dist');

await fs.mkdir(DIST, { recursive: true });
const version = JSON.parse(await fs.readFile(path.join(SRC, 'manifest.json'), 'utf8')).version;
const out = path.join(DIST, `split-proxy-${version}.xpi`);

// Windows 上 Compress-Archive 会带一个顶层目录，扩展装不上。
// 用 .NET 的 ZipFile 逐文件写入。
//
// ⚠️ 不能用 CreateFromDirectory：它在 Windows 上把 entry 名写成 `icons\icon-16.png`
// （反斜杠），而 zip 规范（APPNOTE 4.4.17.1）要求正斜杠。Firefox 按规范解析，
// 反斜杠可能被当成文件名的一部分 → 图标找不到。所以这里手动指定 entry 名并统一成 `/`。
// 临时 zip 就放在 dist 里：跨盘（C: 临时目录 → D: 项目）rename 会 EXDEV。
const tmp = path.join(DIST, `.tmp-${Date.now()}.zip`);
const q = (s) => s.replace(/'/g, "''");

/** 递归收集 src 下所有文件，返回 { full, entry } */
async function collect(dir, base = dir) {
  const out = [];
  for (const e of await fs.readdir(dir, { withFileTypes: true })) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) out.push(...await collect(full, base));
    else out.push({ full, entry: path.relative(base, full).split(path.sep).join('/') });
  }
  return out;
}
const files = (await collect(SRC)).sort((a, b) => a.entry.localeCompare(b.entry));

const pairs = files.map((f) => `@('${q(f.full)}', '${q(f.entry)}')`).join(',\n  ');
const ps = `
Add-Type -AssemblyName System.IO.Compression.FileSystem
if (Test-Path '${q(tmp)}') { Remove-Item '${q(tmp)}' -Force }
$zip = [System.IO.Compression.ZipFile]::Open('${q(tmp)}', 'Create')
try {
  $items = @(
  ${pairs}
  )
  foreach ($it in $items) {
    [void][System.IO.Compression.ZipFileExtensions]::CreateEntryFromFile($zip, $it[0], $it[1], 'Optimal')
  }
} finally { $zip.Dispose() }
`;
const r = spawnSync('powershell', ['-NoProfile', '-Command', ps], { encoding: 'utf8' });
if (r.status !== 0) {
  console.error('打包失败：', r.stderr || r.stdout);
  process.exit(1);
}
await fs.rm(out, { force: true });
await fs.rename(tmp, out);

const st = await fs.stat(out);
console.log(`✅ ${path.relative(process.cwd(), out)}  ${(st.size / 1024).toFixed(1)} KB`);

// 顺手列出包内容，确认没有把乱七八糟的东西打进去
const list = spawnSync('powershell', ['-NoProfile', '-Command',
  `Add-Type -AssemblyName System.IO.Compression.FileSystem
   [System.IO.Compression.ZipFile]::OpenRead('${out.replace(/'/g, "''")}').Entries | ForEach-Object { $_.FullName + '  ' + $_.Length }`],
{ encoding: 'utf8' });
console.log('\n包内容：');
console.log(list.stdout.trim());
