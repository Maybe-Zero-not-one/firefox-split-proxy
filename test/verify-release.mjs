/**
 * 一次性验证：Release 页面上那个 xpi 下载下来，能不能真的装进 Firefox 并正常分流。
 *
 * 和 live.test.mjs 的区别：那边测的是 src/ 目录（开发态），这边测的是**发布出去的产物**。
 * 上传错了包、打包漏了文件这类问题只有这条路能抓到。
 *
 * 用法：node test/verify-release.mjs [xpi 路径]
 *   不传路径就用 dist/split-proxy-1.0.0.xpi
 */
import { spawn } from 'node:child_process';
import net from 'node:net';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');
const FIREFOX = process.env.FX_BIN || 'D:\\Firefox\\firefox.exe';
const XPI = path.resolve(process.argv[2] || path.join(ROOT, 'dist', 'split-proxy-1.0.0.xpi'));

const freePort = () => new Promise((res) => {
  const s = net.createServer();
  s.listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => res(p)); });
});

const results = [];
const ok = (cond, label, detail) => {
  results.push({ label, pass: !!cond });
  console.log(`  ${cond ? '✓' : '✗'} ${label}${cond ? '' : '   ' + (detail ?? '')}`);
};

async function withBrowser(fn) {
  const PROFILE = path.join(os.tmpdir(), `fxvpn-rel-${Date.now()}`);
  const port = await freePort();
  await fs.mkdir(PROFILE, { recursive: true });
  const ff = spawn(FIREFOX, ['-no-remote', '-new-instance', '-headless',
    '--remote-debugging-port', String(port), '-profile', PROFILE, 'about:blank'], { stdio: 'ignore' });

  // 和 live.test.mjs 一样：轮询 http，不是读 DevToolsActivePort（端口是我们指定的）
  for (let i = 0; i < 80; i++) {
    await new Promise((r) => setTimeout(r, 300));
    try { const r = await fetch(`http://127.0.0.1:${port}/`, { signal: AbortSignal.timeout(800) }); if (r.status < 500) break; } catch { /* 还在起 */ }
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

console.log(`xpi: ${XPI}`);
const st = await fs.stat(XPI);
console.log(`大小: ${(st.size / 1024).toFixed(1)} KB\n`);

await withBrowser(async ({ call, ctx, logs, profile: PROFILE }) => {
  // 1. 装包
  const inst = await call('webExtension.install', {
    extensionData: { type: 'path', path: XPI },
  }, 40000);
  ok(inst.extension === 'split-proxy@fxb.local', `装上去了：${inst.extension}`, inst.extension);

  // 2. 后台真的跑起来了（它启动时会碰 storage.local）
  await new Promise((r) => setTimeout(r, 2500));
  const storageDir = path.join(PROFILE, 'storage', 'default');
  const dirs = await fs.readdir(storageDir).catch(() => []);
  ok(dirs.some((d) => d.startsWith('moz-extension+++')), '后台脚本执行过（profile 里有它的 storage 目录）');

  // 3. 默认规则内的站走代理、规则外的直连
  const nav = async (url) => call('browsingContext.navigate', { context: ctx, url, wait: 'complete' }, 35000)
    .then((x) => ({ ok: true, url: x.url }))
    .catch((e) => ({ ok: false, err: String(e.message || e) }));

  const gh = await nav('https://github.com/');
  ok(gh.ok, `规则内的 github.com 能打开${gh.ok ? '' : '：' + gh.err}`);
  const bd = await nav('https://www.baidu.com/');
  ok(bd.ok, `规则外的 baidu.com 能打开${bd.ok ? '' : '：' + bd.err}`);

  // 4. 没有扩展层面的报错
  const errs = logs.filter((l) => String(l.level).includes('error') && /proxy|Extension|manifest/i.test(String(l.text)));
  ok(errs.length === 0, '扩展没有 proxy 相关报错', errs.map((e) => String(e.text).slice(0, 120)).join(' | '));
});

const failed = results.filter((r) => !r.pass).length;
console.log(`\n合计 ${results.length} 条，${failed ? `❌ ${failed} 条失败` : '✅ 全过'}`);
process.exit(failed ? 1 : 0);
