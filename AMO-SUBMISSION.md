# AMO 商店页文案

提交到 addons.mozilla.org 时，这几个字段要填。直接抄下面的即可。

---

## Name（名称，最多 45 字符）

```
分域代理（Clash 分流）
```

## Summary（一句话简介，最多 250 字符）

```
按域名决定谁走代理：把需要翻墙的站点送进你本机的 Clash / v2ray 等代理端口，其余保持直连。只影响 Firefox，不动系统代理。
```

## Description（详细描述）

```
分域代理让你按域名分流，而不是"整个浏览器开代理"或"整个系统开代理"。

它解决的具体问题
────────────────
你本机跑着 Clash（或任何在本地开了 HTTP / SOCKS5 端口的代理工具），
但只想让某几个网站走它 —— 其它的（银行、内网、公司系统、国内视频站）
必须走直连，否则要么慢、要么直接不可用。

系统代理做不到这件事（它一刀切），Clash 的 TUN 模式也会劫持全部流量。
这个扩展把分流的决定放在浏览器里：每个请求单独判断，命中规则的才交给代理。

怎么用
──────
1. 填你代理工具的本地端口（Clash Verge 默认混合端口 7897）
2. 写规则，一行一条：
     google.com          ← 只写域名＝后缀匹配，含所有子域
     DOMAIN,x.com        ← 只要 x.com 本身
     DOMAIN-KEYWORD,ai   ← 域名里含 ai 就算
     IP-CIDR,10.0.0.0/8  ← 按 IP 段
3. 点工具栏图标可以看到当前状态、测试出口、临时关掉

特点
──────
• 逐请求决策，不是全局开关
• 规则改完立刻生效，不用重启浏览器
• 支持 HTTP 和 SOCKS5（SOCKS5 会把 DNS 也交给代理解析，避免本地泄漏）
• 显示最近走过代理的域名，方便确认规则对不对
• 一行一条的纯文本规则，支持注释，能直接从 Clash 配置里抄

它不做什么
──────────
• 不提供任何代理服务，不带节点，不读订阅 —— 你需要自己有代理工具在跑
• 不接管系统代理、不做 TUN、不影响其它浏览器和程序
• 不支持按站点切换不同节点（那要在你的代理工具里配）

关于权限
────────
proxy        设置按请求的代理路由（核心功能）
<all_urls>   需要看到每个请求的 URL 才能判断走不走代理
storage      存你的规则和端口设置
tabs         仅用于"打开设置页"

所有数据都留在本机，不发往任何服务器。扩展本身不联网 —— 唯一一次网络请求
是你在弹窗里点"测一下出口"时，它去请求 api.ipify.org 看出口 IP。
```

## Categories（分类）

```
Privacy & Security
```

## Tags（标签，最多 10 个）

```
proxy, clash, split tunneling, privacy, network, vpn, socks, http proxy
```

## Privacy Policy（隐私政策，AMO 现在必填）

```
本扩展不收集、不上传、不分享任何用户数据。

具体说明：
• 你的规则、端口设置存在浏览器本地（storage.local），不离开这台机器。
• 扩展不包含任何统计、埋点、崩溃上报或远程配置。
• 扩展不主动联网。唯一会发起网络请求的地方，是你在弹窗里点「测一下出口」时，
  它会请求 https://api.ipify.org?format=json 来显示当前出口 IP。
  这一次请求同样受你的规则控制：如果 api.ipify.org 不在规则里，它会走直连。
  你完全可以不用这个按钮，扩展其余部分完全不联网。
• 扩展会看到你访问的每一个 URL（这是 proxy API 的工作方式决定的，否则无法判断走不走代理），
  但只在内存里判断域名是否命中规则，不记录、不持久化、不外发。
  「最近走过的域名」列表只存在内存里，关掉浏览器就没了，最多 40 条。

联系方式：见扩展详情页的作者邮箱。
```

## Notes to Reviewer（给审核员的说明 —— 这栏很关键）

```
This extension routes requests per-domain through a user-configured local proxy.
It is a split-tunneling helper; it provides no proxy service itself.

Why it needs <all_urls>:
  proxy.onRequest fires per request and we decide proxy vs. direct from the URL's
  hostname. Without <all_urls> the listener would not receive the requests it must
  route. We only read the hostname; nothing is stored or transmitted.

Why MV2 (background.scripts) instead of MV3:
  proxy.onRequest is a persistent listener. In MV3 the background service worker is
  suspended, and re-registering the listener on every wake-up adds latency to
  request handling. Firefox fully supports MV2, so we stay on it for now.

Nothing is loaded remotely:
  No eval, no new Function, no remote scripts, no remote config, no analytics.
  All code ships in the package. Icons are inline SVG.

innerHTML:
  The linter's UNSAFE_VAR_ASSIGNMENT warnings are resolved — the UI builds DOM with
  createElement / textContent / replaceChildren only. web-ext lint reports 0 errors,
  0 notices, 0 warnings for this package.

The one network request:
  The popup's "Test exit" button fetches https://api.ipify.org?format=json to show
  the current egress IP. It only runs on an explicit user click, and it goes through
  the same rule engine (so it may go direct). Everything else is offline.

Permissions used, and only these:
  proxy        - proxy.onRequest, per-request routing
  <all_urls>   - required for onRequest to see requests
  storage      - persist the user's rules and port
  tabs         - only to open the options page

Build: none. The submitted package is the exact source in the repo; no transpiling,
no bundling, no generated files. Source is therefore not required, but it is
available at https://github.com/Maybe-Zero-not-one/firefox-split-proxy
(public repository; the submitted package is byte-identical to src/ in it).
```

## Source code submission（如果表单那步选了「是」）

严格按 AMO 那页的判定标准（"代码生成或压缩工具 / webpack 等合并工具 / Web 模板引擎 /
任何二次处理"），本扩展**都没用过**，正确答案是**选「否」**：

- 提交的 `.xpi` 里 8 个文件与仓库 `src/` 的 8 个文件 **SHA-256 逐一相同**
- 没有转译、没有拼接、没有压缩、没有代码生成

如果已经选了「是」并把上传框展开了，就传这个文件：

```
dist/split-proxy-1.0.0-source.zip    36.3 KB
```

它包含 `src/`（8 个源文件）+ `test/`（4 个脚本）+ `BUILD.md` + `README.md` + `LICENSE` +
`AMO-SUBMISSION.md`。审核员解压后跑 `node test/build.mjs` 即可复现出提交的 xpi ——
**产出的 xpi 与提交包 SHA-256 完全相同**（`8437A69B…FBAC6A`）。

构建环境与步骤见包内 `BUILD.md`。


## 上传前检查清单

```powershell
cd fxvpn
node test/match.test.mjs      # 48 条
node test/static.test.mjs     # 37 条（含 web-ext lint = 0 error / 0 warning）
node test/live.test.mjs       # 10 条（真 Firefox）
node test/build.mjs           # 产出 dist/split-proxy-1.0.0.xpi
```

- [ ] `web-ext lint` 零 error 零 warning
- [ ] 版本号比上一次提交大（首次随意，之后必须递增）
- [ ] 隐私政策填了（AMO 现在强制）
- [ ] Notes to Reviewer 里说清了 `<all_urls>` 和联网那一次
- [ ] 上传 `dist/split-proxy-1.0.0.xpi`
- [ ] 「需要提交源代码吗」按实际情况选：本扩展**无构建步骤**，应选**否**；
      若已选「是」，上传 `dist/split-proxy-1.0.0-source.zip`
