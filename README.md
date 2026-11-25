# 分域代理 · 让指定网站走本地 Clash

Firefox 扩展。规则内的站点走本地 Clash，其余保持直连。**只影响 Firefox，不动系统代理，也不影响其它浏览器和程序。**

仓库：<https://github.com/Maybe-Zero-not-one/firefox-split-proxy>（MIT）

**下载**：到 [Releases](https://github.com/Maybe-Zero-not-one/firefox-split-proxy/releases/latest) 取 `split-proxy-1.0.0.xpi`，安装方式见那页说明。

```
                    ┌─ 规则内（github.com …）→ 127.0.0.1:7897 (Clash) → 出口 211.20.x.x
Firefox 请求 ───────┤
                    └─ 规则外（baidu.com …）→ 直连 → 家里宽带出口
```

## 能做到吗：能，而且已经在你这台机器上跑通了

先说清**为什么能**，这个决定了整套设计：

Firefox 的 `proxy.settings` API 是**全局**的 —— 只能设"所有请求走同一个代理"，做不了按站分流。
真正的分流只能靠 **`proxy.onRequest`**：它对**每一个请求**单独问一次"你要走哪"，我们按 URL 回答。
代价是每个请求都要过一遍 JS 回调，所以匹配逻辑必须很轻（`match.js` 全是纯函数，没有任何 IO）。

实测结果（`node test/live.test.mjs`，Firefox 160.0.1）：

| 场景 | 结果 |
|---|---|
| 规则内的 github.com | 走 Clash，1849 ms 打开 |
| 规则外的 baidu.com | 直连，**62 ms** 打开 |
| 把代理改到死端口 `127.0.0.1:1`，github 在规则内 | **失败**（`NS_ERROR_PROXY_CONNECTION_REFUSED`） |
| 同一配置下 baidu 在规则外 | **照常打开** |
| 空规则 + 默认走代理 | github 也走 Clash，能打开 |

第三、四行是关键：**规则内的站被真的送进了代理，规则外的真的没走**。这不是"看起来在跑"。

## 你机器上的现状（已探明）

| | |
|---|---|
| Clash | Clash Verge Rev，`verge-mihomo.exe` v1.19.33 |
| 混合端口 | **7897**（HTTP 和 SOCKS5 都吃，实测两种协议都能出网） |
| 外部控制 | `127.0.0.1:9097` 没监听（Verge 里 `enable_external_controller: false`），但**命名管道可用**，能查到策略组 |
| 策略组 | `国外流量`（当前 台湾 01）、`国内流量`（DIRECT）、`GLOBAL` |
| 系统代理 | **关着**（`ProxyEnable: 0`）—— 所以现在浏览器全靠直连 |
| 直连情况 | 国内站正常；`api.ipify.org` 这类**直连超时**（所以走代理才能测出口 IP） |

## 安装

Firefox 是 **release 渠道**，默认拒绝未签名扩展，两条路选一条：

### 方式 A：临时加载（最快，重启浏览器就消失）

```
about:debugging#/runtime/this-firefox
→ 临时载入附加组件 → 选 fxvpn/src/manifest.json
```

适合先试试手感。缺点：每次重启 Firefox 都要重来。

### 方式 B：装 xpi 并允许未签名（长期用）

1. `about:config` → `xpinstall.signatures.required` 设为 `false`
2. `about:addons` → 右上齿轮 → 从文件安装附加组件 → 选 `fxvpn/dist/split-proxy-1.0.0.xpi`

> 你机器上 `D:\Firefox` 可写（当前用户不是管理员但目录权限允许），
> 所以也可以走企业策略法（`distribution/policies.json` 里 `ExtensionSettings` 白名单），
> 那样不用改 `xpinstall.signatures.required`。缺点是改安装目录，升级 Firefox 时可能被覆盖。

## 用法

点工具栏图标 → 总开关 + 出口测试；「规则设置」打开完整配置。

规则写法（一行一条，`#` 注释）：

```
google.com                  ← 只写域名＝后缀匹配，含 www / mail 等所有子域
youtube.com
DOMAIN,x.com                ← 只要 x.com 本身，不含子域
DOMAIN-KEYWORD,openai       ← 域名里含 openai 就算
IP-CIDR,10.0.0.0/8          ← 按 IP 段（少见，本地分流一般用不上）
```

**规则匹配的是域名，不是 IP。** 这条要知道，因为它有个坑：

> 主页面走了代理，但它引用的静态资源在**别的域**（CDN），那些请求不会命中规则 → 走直连。
> 如果那个 CDN 域在国内能连，页面照样能用；如果连不上，就得把 CDN 域也加进规则。
> 实测过：给 baidu 只放行 `baidu.com` 不行，还得放行 `bdstatic.com`、`bdimg.com`，
> 否则页面主文档能开、样式脚本全挂。

## 与 Clash 的关系

这个扩展**只管"哪些请求从哪个本地端口出去"**，分流到哪个节点完全由 Clash 决定：

- 扩展把 github 送进 `127.0.0.1:7897`
- Clash 按它自己的规则集（`mode: rule`）决定走 `国外流量` 组的哪个节点

所以 Clash 里那套规则**照样生效**。如果你的 Clash 规则已经把 google 分流到国外节点，扩展这边只需要
"把 google 从直连改成走 Clash"这一件事 —— 两层的职责不重叠。

**没有做的事**（也说清）：

- 不读 Clash 的订阅，不解析节点，不切节点
- 不接管系统代理、不管 TUN
- 不支持 UDP（Firefox 的 proxy API 本身不支持）

切换节点请继续用 Clash Verge 自己。想按站点切不同节点的话，得在 Clash 里加规则组，
扩展做不到（它只能选"走不走这个端口"）。

## 开发

```powershell
cd fxvpn
node test/match.test.mjs     # 48 条 · 规则引擎（纯函数，0.1 秒）
node test/static.test.mjs    # 37 条 · manifest/语法/id 一致性/官方 lint（=AMO 那套）
node test/live.test.mjs      # 10 条 · 真 Firefox 装扩展 + 真分流验证（约 40 秒）
node test/build.mjs          # 打包成 dist/*.xpi
```

`live.test.mjs` 用一次性 profile，跑完删掉，不碰你日常的 Firefox。
它还会**临时构建三个变体**（改端口/改默认目标）来证明分流真的生效 —— 见文件头注释。

## 结构

```
src/
  manifest.json   MV2（Firefox 对 MV2 支持最完整，proxy API 也够用）
  match.js        规则解析与匹配（纯函数，能直接跑 Node 测试）
  bg.js           proxy.onRequest 决策 + 设置存储 + 与 UI 通信
  popup.html/js   工具栏弹窗：总开关、出口测试、最近走过的域
  options.html/js 规则编辑
dist/
  split-proxy-1.0.0.xpi
test/
  match.test.mjs  48 条
  static.test.mjs 37 条
  live.test.mjs   10 条
  build.mjs       打包
```

## 已知限制

- **只对 Firefox 生效。** 别的浏览器、别的程序照旧。
- **MV2**。Firefox 现在也支持 MV3，但 MV2 的 `background.scripts` 常驻更适合这种"每次请求都要问一次"的场景（MV3 的 service worker 会被回收，装监听要重来）。等 Firefox 真的下掉 MV2 再迁。
- **`proxy.onRequest` 每请求一次 JS 调用**。规则多了会慢一点点（几万条规则会明显）；日常几十条无感。
- **`moz-extension://` 页面在自动化里打不开**（BiDi 限制），所以 UI 用静态检查覆盖，不是真的渲染截图验证过。
- Clash 关掉时，规则内的站点会直接报 `NS_ERROR_PROXY_CONNECTION_REFUSED` —— 这是预期行为，不是 bug。
