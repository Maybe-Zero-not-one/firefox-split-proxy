/**
 * 从 src/icon.svg 生成多尺寸 PNG。
 *
 * 路线：把浏览器里 canvas 渲染出的 PNG 落盘，再由 Pillow 降采样。
 * 为什么不在浏览器里直接渲染每个尺寸：浏览器对 SVG 的 16px 渲染会走快速缩放，
 * 512 主图 + LANCZOS 降采样边缘更干净。
 *
 * 分两步是因为 base64 太大（几十 KB）不适合走命令行参数：
 *   1. node test/make-icons.mjs page   → 打印要执行的 eval 表达式
 *   2. 在浏览器里跑那段 eval，返回值存成 icons/master.b64
 *   3. node test/make-icons.mjs build  → 解码 + 降采样
 */
import { execFile } from 'node:child_process';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');
const SRC = path.join(ROOT, 'src', 'icon.svg');
const OUT = path.join(ROOT, 'icons');
const PY = process.env.FX_PY
  || 'C:\\Users\\27313\\.dsh\\dsh-runtimes\\dsh-primary-runtime\\dependencies\\python\\python.exe';

const MODE = process.argv[2] || 'page';
const SIZES = [16, 32, 48, 64, 96, 128];

await fs.mkdir(OUT, { recursive: true });

if (MODE === 'page') {
  // 生成一个 512×512 的纯图标页，供浏览器打开后跑 eval
  const svg = await fs.readFile(SRC, 'utf8');
  const b64 = Buffer.from(svg, 'utf8').toString('base64');
  const page = path.join(OUT, '.raster.html');
  await fs.writeFile(page, `<!doctype html><meta charset="utf-8">
<style>html,body{margin:0;padding:0;background:transparent}
img{display:block;width:512px;height:512px}</style>
<img id="i" src="data:image/svg+xml;base64,${b64}">`, 'utf8');
  console.log('渲染页已写到:', path.relative(ROOT, page));
  console.log('\n在浏览器打开它（或直接对当前页执行），跑这段：\n');
  console.log(`(() => { const i = document.getElementById('i') || document.querySelector('img');
  const c = document.createElement('canvas'); c.width = 512; c.height = 512;
  const x = c.getContext('2d'); x.drawImage(i, 0, 0, 512, 512);
  return c.toDataURL('image/png'); })()`);
  console.log('\n把返回值（去掉 data:image/png;base64, 前缀也行）存成 icons/master.b64');
  process.exit(0);
}

if (MODE === 'build') {
  const b64Path = path.join(OUT, 'master.b64');
  let raw;
  try {
    raw = (await fs.readFile(b64Path, 'utf8')).trim();
  } catch {
    console.error('缺 icons/master.b64 —— 先跑 page 模式并把 eval 结果存进去');
    process.exit(1);
  }
  // 兼容带引号的 JSON 字符串 / 带前缀 / 纯 base64
  raw = raw.replace(/^"|"$/g, '').replace(/^data:image\/png;base64,/, '').replace(/\\n/g, '');
  const master = path.join(OUT, 'icon-512.png');
  await fs.writeFile(master, Buffer.from(raw, 'base64'));
  console.log(`主图 ${path.relative(ROOT, master)}  ${(Buffer.from(raw, 'base64').length / 1024).toFixed(1)} KB`);

  const py = `
from PIL import Image
import sys, os
src, out, sizes = sys.argv[1], sys.argv[2], [int(x) for x in sys.argv[3].split(',')]
im = Image.open(src).convert('RGBA')
# 校验：必须已经带圆角透明（四角 alpha=0），否则说明渲染时带了白底
if im.getpixel((0, 0))[3] != 0:
    print('WARN 左上角不透明，主图可能带了背景色', file=sys.stderr)
for s in sizes:
    r = im.resize((s, s), Image.LANCZOS)
    p = os.path.join(out, f'icon-{s}.png')
    r.save(p, optimize=True)
    print(f'  {p}  {os.path.getsize(p)} B')
`;
  const r = await new Promise((res) => {
    execFile(PY, ['-c', py, master, OUT, SIZES.join(',')], { encoding: 'utf8' }, (e, out, err) => {
      res({ code: e ? 1 : 0, out, err });
    });
  });
  if (r.err) console.error(r.err.trim());
  if (r.code !== 0) { console.error('❌ Pillow 失败'); process.exit(1); }
  console.log(r.out.trim());
  process.exit(0);
}

console.error('用法: node test/make-icons.mjs page|build');
process.exit(2);
