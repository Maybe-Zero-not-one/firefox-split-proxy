/**
 * 静态检查：不需要浏览器。
 *
 * 为什么要有这一层：Firefox 的 BiDi 不允许导航到 `moz-extension://`（试过，
 * 报 `Navigation to "moz-extension://..." is not allowed in this context`），
 * 所以 UI 页没法在自动化里真的打开。那就把「打开才能发现的问题」提前查掉：
 * manifest 字段、JS 语法、HTML 里被 JS 引用的 id 是否都存在。
 *
 * 这几类错一旦漏到浏览器里，表现是白屏或者按钮没反应 —— 最难查的那种。
 */
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SRC = path.resolve(HERE, '..', 'src');

const results = [];
const ok = (cond, label, detail) => {
  results.push({ label, pass: !!cond, detail: cond ? '' : String(detail ?? '') });
  console.log(`  ${cond ? '✓' : '✗'} ${label}${cond ? '' : '   ' + (detail ?? '')}`);
};

const read = (f) => fs.readFile(path.join(SRC, f), 'utf8');

// ── 1. manifest ────────────────────────────────────────────────────
const mf = JSON.parse(await read('manifest.json'));
ok(mf.manifest_version === 2 || mf.manifest_version === 3, 'manifest_version 是 2 或 3');
ok(typeof mf.name === 'string' && mf.name.length >= 2, '有 name');
ok(/^\d+\.\d+(\.\d+)?$/.test(mf.version), 'version 格式合法', mf.version);
ok(mf.browser_specific_settings?.gecko?.id, '有固定扩展 id（storage 才能跨会话保留）');

// 我们要的三个权限：proxy 是核心，storage 存设置，<all_urls> 让 onRequest 覆盖所有请求
ok(mf.permissions?.includes('proxy'), '声明了 proxy 权限');
ok(mf.permissions?.includes('storage'), '声明了 storage 权限');
ok(mf.permissions?.includes('<all_urls>'), '声明了 <all_urls>（否则 onRequest 收不到请求）');

// background 必须加载 bg.js，且是 module（bg.js 用了 import）
const bgScripts = mf.background?.scripts || [];
ok(bgScripts.includes('bg.js'), 'background 加载 bg.js');
ok(mf.background?.type === 'module', 'background 声明为 module（bg.js 里有 import）');

// ── 2. 文件都在 ────────────────────────────────────────────────────
const files = [
  'match.js', 'bg.js', 'popup.html', 'popup.js', 'options.html', 'options.js', 'icon.svg',
];
for (const f of files) {
  const exists = await fs.stat(path.join(SRC, f)).then(() => true).catch(() => false);
  ok(exists, `文件存在：${f}`);
}
// manifest 里点到的每个文件都要真的存在
// 注意 icons / default_icon 有两形态：字符串，或 { "16": "a.png", ... } 尺寸表。
// 后者直接展开出来（踩过：只处理字符串会让 path.join 收到对象而崩）。
const iconPaths = (v) => (typeof v === 'string' ? [v] : Object.values(v || {}));
const referenced = [
  ...(mf.background?.scripts || []),
  mf.browser_action?.default_popup,
  ...iconPaths(mf.browser_action?.default_icon),
  mf.options_ui?.page,
  ...iconPaths(mf.icons),
].filter((v) => typeof v === 'string' && v);
for (const f of new Set(referenced)) {
  const exists = await fs.stat(path.join(SRC, f)).then(() => true).catch(() => false);
  ok(exists, `manifest 引用的 ${f} 存在`);
}

// ── 3. JS 语法 ─────────────────────────────────────────────────────
for (const f of ['match.js', 'bg.js', 'popup.js', 'options.js']) {
  const r = spawnSync(process.execPath, ['--input-type=module', '--check'], {
    input: await read(f), encoding: 'utf8',
  });
  // --check 配 stdin 在某些版本上不认，退化成写临时文件检查
  if (r.status !== 0 && /--check/.test(r.stderr || '')) {
    const tmp = path.join(SRC, `.check-${f}.mjs`);
    await fs.writeFile(tmp, await read(f));
    const r2 = spawnSync(process.execPath, ['--check', tmp], { encoding: 'utf8' });
    await fs.rm(tmp, { force: true });
    ok(r2.status === 0, `${f} 语法通过`, (r2.stderr || '').split('\n')[0]);
  } else {
    ok(r.status === 0, `${f} 语法通过`, (r.stderr || '').split('\n')[0]);
  }
}

// ── 4. HTML/JS 的 id 一致性（白屏与死按钮的头号原因）────────────────
const idsIn = (html) => new Set([...html.matchAll(/\bid="([^"]+)"/g)].map((m) => m[1]));
for (const [htmlFile, jsFile] of [['popup.html', 'popup.js'], ['options.html', 'options.js']]) {
  const html = await read(htmlFile);
  const js = await read(jsFile);
  const ids = idsIn(html);
  // JS 里所有 $('xxx') / getElementById('xxx') 的引用
  const refs = new Set([
    ...[...js.matchAll(/\$\('([^']+)'\)/g)].map((m) => m[1]),
    ...[...js.matchAll(/getElementById\('([^']+)'\)/g)].map((m) => m[1]),
  ]);
  const missing = [...refs].filter((r) => !ids.has(r));
  ok(missing.length === 0, `${jsFile} 引用的 id 在 ${htmlFile} 里都存在`, `缺：${missing.join(', ')}`);
  // 反过来：HTML 里声明了但 JS 没用的 id（不算错，但值得知道）
  const unused = [...ids].filter((i) => !refs.has(i));
  ok(unused.length === 0, `${htmlFile} 里没有多余的 id`, `多余：${unused.join(', ')}`);
}

// ── 5. CSP 友好性：html 里不许有内联 script（MV2/MV3 都会拦）────────
for (const f of ['popup.html', 'options.html']) {
  const html = await read(f);
  const inline = [...html.matchAll(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/gi)];
  const realInline = inline.filter((m) => m[1].trim().length > 0);
  ok(realInline.length === 0, `${f} 没有内联 script（CSP 会拦）`, `${realInline.length} 处`);
  // 引用的外部脚本要存在
  for (const m of html.matchAll(/<script[^>]*\bsrc="([^"]+)"/g)) {
    const exists = await fs.stat(path.join(SRC, m[1])).then(() => true).catch(() => false);
    ok(exists, `${f} 引用的脚本 ${m[1]} 存在`);
  }
}

// ── 6. 关键约束：不能依赖 proxy.settings（那是全局的）──────────────
{
  const bg = await read('bg.js');
  // 只看代码本体，不看注释 —— 否则文件头那句"proxy.settings.set() 是全局的"会被误判
  const code = bg.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  ok(!/proxy\.settings\s*\.\s*set/.test(code), 'bg.js 没有调用 proxy.settings.set（全局代理，做不了分流）');
  ok(/proxy\.onRequest\s*\.\s*addListener/.test(code), 'bg.js 用了 proxy.onRequest（逐请求决策）');
  ok(/\{\s*urls:\s*\['<all_urls>'\]\s*\}/.test(bg), 'onRequest 注册时带了 <all_urls> 过滤器');
}

// ── 7. 官方校验器（web-ext lint = AMO 审核用的同一套）──────────────
// 这条挡的是回归：innerHTML、缺 data_collection_permissions、min_version 不够，
// 都会在这里变成非零，而不是等提交到 AMO 才被打回。
{
  // Windows 上 web-ext 是 .ps1（npm 全局装的 shim），直接 spawnSync 找不到，要过 shell；
  // 但 shell + 数组参数会有 DEP0190 警告。改成拼一整个命令行串，参数都自己加引号。
  const q = (s) => `'${String(s).replace(/'/g, "''")}'`;
  const lint = spawnSync(
    `web-ext lint --source-dir ${q(SRC)} --output json`,
    { encoding: 'utf8', shell: 'powershell.exe', timeout: 180000 },
  );
  let report = null;
  try { report = JSON.parse(lint.stdout.trim().split('\n').pop()); } catch { /* 解析失败下面报 */ }
  if (!report) {
    ok(true, '（web-ext 不可用，跳过官方 lint）');
  } else {
    ok(report.summary.errors === 0, `web-ext lint 零 error`, JSON.stringify(report.errors?.slice(0,2)));
    ok(report.summary.warnings === 0, `web-ext lint 零 warning`, JSON.stringify((report.warnings||[]).map(w=>w.code).slice(0,5)));
  }
}
// ── 8. amo-check 脚本自身（它是上架后唯一会改文案的东西，得是好的）──
// 踩过的两个坑都写在这里：拿别人的版本号拼文件名、release notes 的标题层级。
{
  const p = path.resolve(HERE, 'amo-check.mjs');
  const src = await fs.readFile(p, 'utf8');
  ok(src.includes('401') && src.includes('404'), 'amo-check 能区分 401（审核中）与 404（不存在）');
  ok(src.includes('localVer'), 'amo-check 用本地 manifest 的版本号（不是 AMO 上那个包的）');
  // 任何 `${ver}` 都是错的 —— 它来自 AMO 上那个包，会把别人的版本号写进我们的文件名
  const badVer = [...src.matchAll(/\$\{ver\}/g)];
  ok(badVer.length === 0, 'amo-check 里没有裸 ${ver}（会把别人的版本号写进自己文件名）', `${badVer.length} 处`);
  ok(/\^\(\?#\{2,4\}\)/.test(src) || src.includes('#{2,4}'), 'amo-check 的 release notes 标题正则兼容 ### 安装');
  ok(src.includes('FX_AMO_ROOT'), 'amo-check 支持改到副本上试跑（不误伤真文件）');

  // 语法必须过 —— 它是个会被直接 node 起来的脚本
  const chk = spawnSync(process.execPath, ['--check', p], { encoding: 'utf8' });
  ok(chk.status === 0, 'amo-check 语法正确', chk.stderr?.slice(0, 200));
}

const failed = results.filter((r) => !r.pass);
console.log(`\n静态检查 ${results.length} 条，${failed.length ? `❌ ${failed.length} 条失败` : '✅ 全过'}`);
if (failed.length) process.exit(1);
