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
// 用 .NET 的 ZipFile 从目录内容打包，保持扁平结构。
// 临时 zip 就放在 dist 里：跨盘（C: 临时目录 → D: 项目）rename 会 EXDEV。
const tmp = path.join(DIST, `.tmp-${Date.now()}.zip`);
const q = (s) => s.replace(/'/g, "''");
const ps = `
Add-Type -AssemblyName System.IO.Compression.FileSystem
if (Test-Path '${q(tmp)}') { Remove-Item '${q(tmp)}' -Force }
[System.IO.Compression.ZipFile]::CreateFromDirectory('${q(SRC)}', '${q(tmp)}')
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
