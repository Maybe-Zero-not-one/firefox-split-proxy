/**
 * AMO 上架状态检查 / 自动接线。
 *
 * 用法：
 *   node test/amo-check.mjs <slug|URL>            # 查一次
 *   node test/amo-check.mjs <slug|URL> --watch    # 每 5 分钟查一次，直到上架
 *   node test/amo-check.mjs <slug|URL> --watch --apply   # 上架后自动改 README / Release 说明
 *
 * 三种状态要分清（做法是拿虚构 slug 对照出来的）：
 *   200 + status=public  → 已上架，可以接线
 *   401                  → 插件存在，但未公开（审核中 / 已通过未发布）
 *   404                  → slug 不存在，或已下架（两者从外部区分不出来）
 */
import { execFile } from 'node:child_process';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
// FX_AMO_ROOT 只给测试用：指向一份副本，--apply 就改副本而不动真文件
const ROOT = path.resolve(process.env.FX_AMO_ROOT || path.resolve(HERE, '..'));

const args = process.argv.slice(2);
const watch = args.includes('--watch');
const apply = args.includes('--apply');
const interval = Number((args.find((a) => a.startsWith('--interval=')) || '').split('=')[1] || 300);
const rawArg = args.find((a) => !a.startsWith('--'));
if (!rawArg) {
  console.error('用法: node test/amo-check.mjs <slug|URL> [--watch] [--apply] [--interval=秒]');
  process.exit(2);
}

// 统一成 slug：接受完整 URL、富文本粘贴、纯 slug；中文不做编码（curl 会自己编）
const slug = decodeURIComponent(String(rawArg))
  .replace(/^.*\/addon\//, '')
  .replace(/[?#].*$/, '')
  .replace(/\/+$/, '');
if (!slug) { console.error('解析不出 slug'); process.exit(2); }

const PROXY = process.env.FX_PROXY ?? 'http://127.0.0.1:7897';

function curl(url) {
  return new Promise((res) => {
    const argv = ['-sL', '--max-time', '45', '-H', 'user-agent: amo-check'];
    if (PROXY) argv.push('-x', PROXY);
    argv.push('-w', '\n__HTTP__%{http_code}', url);
    execFile('curl', argv, { maxBuffer: 20e6 }, (_e, out) => {
      const s = String(out || '');
      const i = s.lastIndexOf('__HTTP__');
      res({ body: i >= 0 ? s.slice(0, i) : s, code: i >= 0 ? Number(s.slice(i + 8).trim()) : 0 });
    });
  });
}

const api = (s, tail = '') => `https://addons.mozilla.org/api/v5/addons/addon/${s}/${tail}`;

async function probe() {
  const r = await curl(api(slug));
  const at = new Date().toLocaleString('zh-CN', { hour12: false });

  if (r.code === 401) {
    return { state: 'unpublished', at, note: '插件存在但未公开（审核中，或已通过但还没发布）' };
  }
  if (r.code === 404) {
    return { state: 'missing', at, note: 'slug 不存在，或插件已下架（外部无法区分）' };
  }
  if (r.code !== 200) {
    return { state: 'error', at, note: `HTTP ${r.code}`, body: r.body.slice(0, 300) };
  }

  let j;
  try { j = JSON.parse(r.body); } catch { return { state: 'error', at, note: '返回不是 JSON', body: r.body.slice(0, 300) }; }

  // 200 也可能还没 public（比如状态是 disabled / nominated）
  const dl = await curl(`https://addons.mozilla.org/firefox/downloads/latest/${encodeURIComponent(slug)}/latest.xpi`);
  return {
    state: j.status === 'public' && dl.code === 200 ? 'live' : 'pending',
    at,
    info: j,
    downloadOk: dl.code === 200,
    note: j.status === 'public' ? '状态 public，但下载地址还没好（缓存延迟，等几分钟）' : `状态是 ${j.status}`,
  };
}

const pick = (o, k) => (o && o[k]) || '';

function report(r) {
  if (r.state !== 'live' && r.state !== 'pending') {
    console.log(`[${r.at}] ${r.state === 'unpublished' ? '⏳ 审核中' : r.state === 'missing' ? '❓ 查不到' : '⚠️ 异常'}`);
    console.log(`  ${r.note}`);
    if (r.body) console.log(`  ${r.body}`);
    return;
  }
  const j = r.info;
  const cv = j.current_version || {};
  console.log(`[${r.at}] ${r.state === 'live' ? '✅ 已上架' : '⏳ 已通过但下载未就绪'}`);
  console.log(`  name        : ${pick(j.name, 'zh-CN') || pick(j.name, 'en-US')}`);
  console.log(`  slug        : ${j.slug}`);
  console.log(`  guid        : ${j.guid}`);
  console.log(`  status      : ${j.status}`);
  console.log(`  version     : ${cv.version}`);
  console.log(`  signed xpi  : ${cv.file && cv.file.url}`);
  console.log(`  hash        : ${cv.file && cv.file.hash}`);
  console.log(`  size        : ${cv.file && cv.file.size} bytes`);
  console.log(`  权限        : ${JSON.stringify(cv.file && cv.file.permissions)}`);
  console.log(`  数据收集    : ${JSON.stringify(cv.file && cv.file.data_collection_permissions)}`);
  console.log(`  页面        : ${j.url}`);
  console.log(`  周下载      : ${j.weekly_downloads}   日均用户: ${j.average_daily_users}`);
  console.log(`  稳定下载    : https://addons.mozilla.org/firefox/downloads/latest/${encodeURIComponent(j.slug)}/latest.xpi`);
}

/** 上架后：把两处链接换成 AMO 的，并去掉「必须关签名」那一步 */
async function applyLinks(info) {
  // 用非编码形式（中文 slug 在 markdown 链接里也要能点，浏览器会自己编）
  const pageUrl = info.url || `https://addons.mozilla.org/zh-CN/firefox/addon/${info.slug}/`;
  const dlUrl = `https://addons.mozilla.org/firefox/downloads/latest/${info.slug}/latest.xpi`;

  // 版本号取**本地 manifest**，不是 AMO 上那个包的。
  // （这里踩过：拿 info.current_version.version 会把别人的版本号写进自己文件名）
  const localVer = JSON.parse(await fs.readFile(path.join(ROOT, 'src', 'manifest.json'), 'utf8')).version;

  const changed = [];

  // 1. README
  const readmePath = path.join(ROOT, 'README.md');
  let readme = await fs.readFile(readmePath, 'utf8');
  const before = readme;
  readme = readme.replace(
    /^\*\*下载\*\*：[^\n]*$/m,
    `**安装（推荐）**：[Firefox 附加组件商店](${pageUrl}) 一键安装 —— 无需改任何设置。\n\n` +
    `**离线安装**：[Releases](https://github.com/Maybe-Zero-not-one/firefox-split-proxy/releases/latest) 取 \`split-proxy-${localVer}.xpi\`。`
  );
  if (readme !== before) {
    await fs.writeFile(readmePath, readme);
    changed.push('README.md');
  }

  // 2. RELEASE-NOTES：在安装段之前插入 AMO 一条
  const notesPath = path.join(ROOT, `RELEASE-NOTES-${localVer}.md`);
  try {
    let notes = await fs.readFile(notesPath, 'utf8');
    const nb = notes;
    if (!notes.includes('addons.mozilla.org')) {
      // 标题层级是 ### 安装（GitHub Release 正文里）
      notes = notes.replace(
        /^(#{2,4}) 安装$/m,
        `$1 安装（推荐：商店一键装）\n\n` +
        `已上架 Firefox 附加组件商店：[${pick(info.name, 'zh-CN') || info.slug}](${pageUrl})\n\n` +
        `点「添加到 Firefox」即可，**不需要**改 \`xpinstall.signatures.required\`。\n\n` +
        `---\n\n$1 安装（离线 / 自己装 xpi）`
      );
      if (notes !== nb) { await fs.writeFile(notesPath, notes); changed.push(path.basename(notesPath)); }
    }
  } catch { /* 没有对应版本的说明文件就跳过 */ }

  return { changed, pageUrl, dlUrl };
}

// ── 主流程 ────────────────────────────────────────────────────────
console.log(`slug: ${slug}`);
if (PROXY) console.log(`代理: ${PROXY}`);
console.log('');

for (;;) {
  const r = await probe();
  report(r);

  if (r.state === 'live') {
    if (apply) {
      console.log('\n=== 开始接线 ===');
      const out = await applyLinks(r.info);
      if (out.changed.length) {
        console.log('改好了：' + out.changed.join('、'));
        console.log('接着手动确认 diff 后提交：');
        console.log('  git diff');
        console.log('  git add -A && git commit -m "docs: 换成 AMO 商店安装入口"');
        console.log('  git -c http.proxy=http://127.0.0.1:7897 push');
      } else {
        console.log('两处都已经是 AMO 链接了，无需改动。');
      }
      console.log(`\n商店页: ${out.pageUrl}`);
      console.log(`签名包: ${r.info.current_version.file.url}`);
    }
    process.exit(0);
  }
  if (r.state === 'missing') {
    console.error('\nslug 查不到。若是刚提交，可能 slug 被 AMO 改过（中文会被改写）；把开发者后台里「附加组件网址」那栏整行发我。');
    process.exit(3);
  }
  if (!watch) process.exit(r.state === 'unpublished' ? 4 : 1);

  console.log(`  ${interval}s 后再查（Ctrl+C 退出）\n`);
  await new Promise((res) => setTimeout(res, interval * 1000));
}
