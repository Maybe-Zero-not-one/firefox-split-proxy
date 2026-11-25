/**
 * 审核通过后：给一个 slug 或 extensions/ 页面 URL，自动把该拿的信息全拿齐。
 * 用法：node test/amo-check.mjs <slug 或 URL>
 */
const arg = process.argv[2];
if (!arg) { console.error('用法: node test/amo-check.mjs <slug|URL>'); process.exit(2); }
const slug = String(arg).replace(/^.*\/addon\//, '').replace(/\/.*$/, '').replace(/^extensions\//,'');
const PROXY = process.env.FX_PROXY || 'http://127.0.0.1:7897';

async function get(url) {
  const { execFile } = await import('node:child_process');
  return new Promise((res) => {
    execFile('curl', ['-sL','--max-time','40','-x',PROXY,'-H','user-agent: amo-check',url], { maxBuffer: 20e6 }, (e, out) => res(out || ''));
  });
}

console.log('slug:', slug);
const raw = await get(`https://addons.mozilla.org/api/v5/addons/addon/${slug}/`);
let j;
try { j = JSON.parse(raw); } catch { console.error('❌ 不是 JSON（可能 404 / 451）：', raw.slice(0,200)); process.exit(1); }
if (j.detail) { console.error('❌ API 说：', j.detail); process.exit(1); }

const pick = (o, k) => (o && o[k]) || '';
console.log('\n=== 基本信息 ===');
console.log('slug        :', j.slug);
console.log('guid        :', j.guid);
console.log('name        :', pick(j.name,'zh-CN') || pick(j.name,'en-US'));
console.log('summary     :', pick(j.summary,'zh-CN') || pick(j.summary,'en-US'));
console.log('status      :', j.status);
console.log('created     :', j.created);
console.log('last_updated:', j.last_updated);
console.log('url         :', j.url);
console.log('edit_url    :', j.edit_url);
console.log('\n=== 当前版本 ===');
const cv = j.current_version || {};
console.log('version     :', cv.version);
console.log('file.url    :', cv.file && cv.file.url);
console.log('file.size   :', cv.file && cv.file.size, 'bytes');
console.log('file.status :', cv.file && cv.file.status);
console.log('file.hash   :', cv.file && cv.file.hash);
console.log('signed      :', cv.file && cv.file.is_mozilla_signed_extension);
console.log('\n=== 权限（审核时声明的）===');
console.log('permissions :', JSON.stringify(cv.file && cv.file.permissions));
console.log('data_collect:', JSON.stringify(cv.file && cv.file.data_collection_permissions));
console.log('\n=== 稳定下载地址（放 README 用）===');
console.log(`https://addons.mozilla.org/firefox/downloads/latest/${j.slug}/latest.xpi`);
console.log('\n=== 统计 ===');
console.log('weekly_downloads    :', j.weekly_downloads);
console.log('average_daily_users :', j.average_daily_users);
