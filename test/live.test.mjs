/**
 * 真浏览器验证：装扩展 → 后台活起来 → 分流真的生效。
 *
 * 两个绕不开的限制（都实测过）：
 * 1. BiDi 不让导航到 `moz-extension://`（`Navigation ... is not allowed in this context`），
 *    所以 UI 页没法在自动化里打开 —— 换成静态检查（static.test.mjs）覆盖。
 * 2. 不能在页面里直接调扩展的 runtime.sendMessage（那是扩展上下文的东西）。
 *
 * 所以这里的做法：**直接写 profile 里的 storage.local**（LevelDB 里的扩展存储），
 * 让扩展一启动就读到我们想要的设置。文件格式是 `storage/default/moz-extension+++<uuid>/idb/`
 * —— 太底层，改为更稳的路子：装一个「配置注入」小扩展？不行，多余。
 *
 * 最终用的办法最朴素也最可靠：**扩展自己的默认设置就是我要验的规则**，
 * 而"改端口"这一步通过 webExtension.install 之后再装一个带不同默认值的副本实现 ——
 * 也就是构建期注入。下面 buildVariant() 就干这个。
 */
import { spawn } from 'node:child_process';
import net from 'node:net';
import http from 'node:http';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SRC = path.resolve(HERE, '..', 'src');
const FIREFOX = process.env.FX_BIN || 'D:\\Firefox\\firefox.exe';

const freePort = () => new Promise((res) => {
  const s = net.createServer();
  s.listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => res(p)); });
});

/** 复制一份 src 到临时目录，按 patch 改其中的默认设置（用来做"必死代理"这类对照） */
async function buildVariant(patch, { id }) {
  const dir = path.join(os.tmpdir(), `fxvpn-build-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`);
  await fs.cp(SRC, dir, { recursive: true });
  // 改扩展 id，避免两个变体互相顶掉
  const mfPath = path.join(dir, 'manifest.json');
  const mf = JSON.parse(await fs.readFile(mfPath, 'utf8'));
  mf.browser_specific_settings.gecko.id = id;
  mf.name = `${mf.name} (${id.split('@')[0]})`;
  await fs.writeFile(mfPath, JSON.stringify(mf, null, 2));

  // 改 bg.js 里的 DEFAULTS
  const bgPath = path.join(dir, 'bg.js');
  let bg = await fs.readFile(bgPath, 'utf8');
  for (const [k, v] of Object.entries(patch)) {
    if (typeof v === 'string') {
      /** 字符串值要加引号；多行用 JSON.stringify 保证转义 */
      bg = bg.replace(new RegExp(`(\\b${k}:\\s*)[^,\\n]*(,\\s*\\/\\/)`, 'm'), `$1${JSON.stringify(v)}$2`);
    } else {
      bg = bg.replace(new RegExp(`(\\b${k}:\\s*)[^,\\n]*(,\\s*\\/\\/)`, 'm'), `$1${v}$2`);
    }
  }
  await fs.writeFile(bgPath, bg);
  return dir;
}

/**
 * 假代理：记录收到的请求，一律 502。
 *
 * 为什么需要它 —— 这条踩了很久：
 * 直觉上「把代理指到死端口，规则内的站就该打不开」。实测不是这样。
 * Firefox 160.0.1 三组对照（port 1 / 7898 / 7897，同一个 github URL）：
 *    port=1     打开 25.2s
 *    port=7898  打开 22.2s
 *    port=7897  打开 14.3s
 * 代理连不上时 Firefox 会**回退直连**，死端口只是变慢，不会失败。
 * 连 proxyHost 写成 no-such-proxy.invalid 也照样打开（15.3s）。
 * （greprefs 里只有 network.proxy.failover_timeout: 1800，没有 failover_direct 这个 pref。）
 *
 * 所以「失败」不能当判据，只能看「代理端有没有收到流量」。
 * 用一个会记账的本地假代理：收到 CONNECT github.com:443 → 分流确实生效。
 * 而且这时导航会在 60ms 左右就失败（502 立刻回来，不用等超时），比等 20 秒快得多。
 */
function startFakeProxy() {
  const hits = [];
  const server = http.createServer((req, res) => {
    hits.push({ method: req.method, url: req.url });
    res.writeHead(502, { 'content-type': 'text/plain' });
    res.end('fake proxy');
  });
  server.on('connect', (req, socket) => {
    hits.push({ method: 'CONNECT', url: req.url });
    socket.write('HTTP/1.1 502 Bad Gateway\r\n\r\n');
    socket.destroy();
  });
  return new Promise((res) => {
    server.listen(0, '127.0.0.1', () => res({ server, hits, port: server.address().port }));
  });
}

const results = [];
const ok = (cond, label, detail) => {
  results.push({ label, pass: !!cond, detail: cond ? '' : String(detail ?? '') });
  console.log(`  ${cond ? '✓' : '✗'} ${label}${cond ? '' : '   ' + (detail ?? '')}`);
};

async function withBrowser(fn) {
  const PROFILE = path.join(os.tmpdir(), `fxvpn-prof-${Date.now()}`);
  const port = await freePort();
  await fs.mkdir(PROFILE, { recursive: true });
  const ff = spawn(FIREFOX, ['-no-remote', '-new-instance', '-headless',
    '--remote-debugging-port', String(port), '-profile', PROFILE, 'about:blank'], { stdio: 'ignore' });

  for (let i = 0; i < 80; i++) {
    await new Promise((r) => setTimeout(r, 300));
    try { const r = await fetch(`http://127.0.0.1:${port}/`, { signal: AbortSignal.timeout(800) }); if (r.status < 500) break; } catch { /* 起 */ }
  }
  const ws = new WebSocket(`ws://127.0.0.1:${port}/session`);
  await new Promise((res, rej) => {
    ws.addEventListener('open', res, { once: true });
    ws.addEventListener('error', rej, { once: true });
  });
  let seq = 0;
  const pending = new Map();
  const logs = [];
  ws.addEventListener('message', (ev) => {
    const m = JSON.parse(ev.data);
    if (m.id !== undefined) {
      const p = pending.get(m.id);
      if (p) { pending.delete(m.id); m.type === 'error' ? p.rej(new Error(`${m.error}: ${m.message}`)) : p.res(m.result); }
      return;
    }
    if (m.method === 'log.entryAdded') logs.push(m.params);
  });
  const call = (method, params = {}, ms = 25000) => new Promise((res, rej) => {
    const id = ++seq; pending.set(id, { res, rej });
    ws.send(JSON.stringify({ id, method, params }));
    setTimeout(() => { if (pending.has(id)) { pending.delete(id); rej(new Error('超时 ' + method)); } }, ms);
  });

  try {
    await call('session.new', { capabilities: {} });
    await call('session.subscribe', { events: ['log.entryAdded'] }).catch(() => {});
    const ctx = (await call('browsingContext.getTree', {})).contexts[0].context;
    return await fn({ call, ctx, logs, profile: PROFILE });
  } finally {
    try { await call('session.end', {}); } catch { /* 已关 */ }
    ws.close();
    ff.kill();
    await new Promise((r) => setTimeout(r, 600));
    await fs.rm(PROFILE, { recursive: true, force: true }).catch(() => {});
  }
}

/**
 * 导航并返回 { ok, ms, error }
 *
 * 默认超时给到 45 秒而不是 15 秒：这条链是「页面 → 本地 Clash → 境外节点」，
 * 节点慢的时候 github.com 单次就要 7–8 秒（实测），加上子资源很容易顶穿 15 秒。
 * 那种失败测的是「此刻节点快不快」，不是「分流对不对」——会把自己骗成代码坏了。
 * 想收紧就设 FX_NAV_TIMEOUT=15000。
 */
const NAV_TIMEOUT = Number(process.env.FX_NAV_TIMEOUT || 45000);
async function nav(call, ctx, url, timeoutMs = NAV_TIMEOUT) {
  const t0 = Date.now();
  try {
    await call('browsingContext.navigate', { context: ctx, url, wait: 'complete' }, timeoutMs);
    return { ok: true, ms: Date.now() - t0 };
  } catch (error) {
    return { ok: false, ms: Date.now() - t0, error: error.message };
  }
}

// ══════════════════════════════════════════════════════════════════
console.log('── 第一轮：默认配置（真实 Clash 7897）──');
await withBrowser(async ({ call, ctx, logs, profile }) => {
  let extId = null;
  try {
    extId = (await call('webExtension.install', { extensionData: { type: 'path', path: SRC } }))?.extension;
    ok(true, `扩展装上了：${extId}`);
  } catch (error) {
    ok(false, '扩展装得上（manifest 合法）', error.message);
  }
  await new Promise((r) => setTimeout(r, 2500));

  // 后台脚本碰过 storage 才有这个目录 —— 这是"后台真的跑了"的证据
  const stDir = path.join(profile, 'storage', 'default');
  const names = await fs.readdir(stDir).catch(() => []);
  const hit = names.find((n) => n.startsWith('moz-extension+++'));
  ok(!!hit, '后台脚本碰过 storage.local（后台真的执行了）', names.join(',') || '(空)');

  // 默认规则里有 github.com → 走 Clash 7897；baidu 不在规则 → 直连
  const stamp = Date.now();
  const gh = await nav(call, ctx, `https://github.com/?_=${stamp}`);
  ok(gh.ok, `规则内的 github.com 走 Clash 能打开（${gh.ms}ms）`, gh.error);
  const bd = await nav(call, ctx, `https://www.baidu.com/?_=${stamp}`);
  ok(bd.ok, `规则外的 baidu.com 直连能打开（${bd.ms}ms）`, bd.error);

  const errs = logs.filter((l) => l.level === 'error' && /split-proxy|proxy/i.test(l.text || ''));
  ok(errs.length === 0, '扩展没有 proxy 相关报错', errs.map((e) => e.text).slice(0, 2).join(' | '));

  if (extId) { try { await call('webExtension.uninstall', { extension: extId }); } catch { /* 已卸 */ } }
});

console.log('\n── 第二轮：把代理指到「会记账的假代理」（证明请求真的进了代理）──');
const fake = await startFakeProxy();
const deadId = 'split-proxy-dead@fxb.local';
const deadDir = await buildVariant({ proxyPort: fake.port }, { id: deadId });
try {
  await withBrowser(async ({ call, ctx }) => {
    let extId = null;
    try {
      extId = (await call('webExtension.install', { extensionData: { type: 'path', path: deadDir } }))?.extension;
      ok(!!extId, `对照扩展装上了：${extId}`);
    } catch (error) {
      ok(false, '对照扩展装得上', error.message);
    }
    await new Promise((r) => setTimeout(r, 2500));

    const one = await nav(call, ctx, `https://github.com/?_=${Date.now()}`);
    const ghHits = fake.hits.filter((h) => String(h.url).includes('github'));
    ok(ghHits.length > 0,
      `假代理收到了 github 的请求（${ghHits.map((h) => `${h.method} ${h.url}`).slice(0, 2).join(', ')}）`,
      `假代理一个 github 请求都没收到（共收到 ${fake.hits.length} 个）—— 分流没生效`);
    // 502 立刻回来，所以导航应当很快失败；这里只断言「确实没走通」
    ok(!one.ok, `被假代理挡下 → 页面打不开（${one.ms}ms）`, `居然打开成功了（${one.ms}ms）`);

    const two = await nav(call, ctx, `https://www.baidu.com/?_=${Date.now()}`);
    const bdHits = fake.hits.filter((h) => String(h.url).includes('baidu'));
    ok(two.ok, `规则外的 baidu.com 直连打开（${two.ms}ms）`, two.error);
    ok(bdHits.length === 0,
      `baidu 没被送进代理（假代理收到 ${bdHits.length} 个 baidu 请求）`,
      `baidu 也被送进代理了（${bdHits.length} 个）—— 规则外不该走代理`);

    if (extId) { try { await call('webExtension.uninstall', { extension: extId }); } catch { /* 已卸 */ } }
  });
} finally {
  try { fake.server.close(); } catch { /* 已关 */ }
  await fs.rm(deadDir, { recursive: true, force: true }).catch(() => {});
}

console.log('\n── 第三轮：默认走代理 + 空规则（总开关的另一档）──');
const allId = 'split-proxy-all@fxb.local';
const allDir = await buildVariant({ defaultTarget: 'proxy', rulesText: '' }, { id: allId });
try {
  await withBrowser(async ({ call, ctx }) => {
    let extId = null;
    try {
      extId = (await call('webExtension.install', { extensionData: { type: 'path', path: allDir } }))?.extension;
      ok(!!extId, `对照扩展装上了：${extId}`);
    } catch (error) {
      ok(false, '对照扩展装得上', error.message);
    }
    await new Promise((r) => setTimeout(r, 2500));
    const stamp = Date.now();
    // 没规则 + 默认走代理 → github 也走 Clash → 能开
    const gh = await nav(call, ctx, `https://github.com/?_=${stamp}`);
    ok(gh.ok, `没有规则但默认走代理时，github 仍能打开（${gh.ms}ms）`, gh.error);
    if (extId) { try { await call('webExtension.uninstall', { extension: extId }); } catch { /* 已卸 */ } }
  });
} finally {
  await fs.rm(allDir, { recursive: true, force: true }).catch(() => {});
}

const failed = results.filter((r) => !r.pass);
console.log(`\n合计 ${results.length} 条，${failed.length ? `❌ ${failed.length} 条失败` : '✅ 全过'}`);
if (failed.length) failed.forEach((f) => console.log('  - ' + f.label + (f.detail ? ' — ' + f.detail : '')));
process.exit(failed.length ? 1 : 0);
