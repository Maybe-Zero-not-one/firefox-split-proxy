# 构建说明（给 AMO 审核员）

## 一句话

**这个扩展没有构建步骤。** 提交的 `.xpi` 就是把 `src/` 目录直接打成一个 zip（改名为 `.xpi`），
包里每个文件和 `src/` 里对应文件**逐字节相同** —— 没有转译、没有拼接、没有压缩、没有代码生成。

## 环境要求

- Windows 10/11（打包脚本用 PowerShell 的 .NET ZipFile；任何能产 zip 的工具都等价）
- Node.js **v24.21.0**
- npm **12.1.0**（只在跑测试时用到，不参与打包）
- 第三方运行时依赖：**无**。`manifest.json` 里没有 `content_scripts` 之外的注入，
  也没有任何外部库；`src/` 内只有 `bg.js` / `options.js` 之间互相 `import './match.js'`。

## 构建步骤

```powershell
# 1. 进项目
cd fxvpn

# 2. 打包（唯一一步。产出 dist/split-proxy-<version>.xpi）
node test/build.mjs
```

复现验证（我这边跑过的）：把源码包解压到空目录，在解压目录里跑 `node test/build.mjs`，
产出的 xpi 与提交的包 **SHA-256 完全相同**（`8437A69B…FBAC6A`）。

`test/build.mjs` 做的事情只有一件：用 `System.IO.Compression.ZipFile::CreateFromDirectory`
把 `src/` 目录的内容压成 zip，然后改扩展名为 `.xpi`。

为什么不用 `Compress-Archive`：它会在包里带一层顶层目录，Firefox 装不上。
为什么临时 zip 放在 `dist/` 而不是系统临时目录：跨盘 rename 会 `EXDEV`。

你也可以完全不用这个脚本，任何保持**扁平结构**（`manifest.json` 在 zip 根目录）的打包方式
都产出一模一样的包，例如：

```bash
cd src && zip -r ../dist/split-proxy-1.0.0.xpi .
```

## 提交的包与仓库的对应关系

```
提交的包 dist/split-proxy-1.0.0.xpi
   ├── manifest.json    ←  src/manifest.json
   ├── bg.js            ←  src/bg.js
   ├── match.js         ←  src/match.js
   ├── popup.html       ←  src/popup.html
   ├── popup.js         ←  src/popup.js
   ├── options.html     ←  src/options.html
   ├── options.js       ←  src/options.js
   └── icon.svg         ←  src/icon.svg
```

逐字节一致（SHA-256 比对过，8/8 相同）。`src/` 里没有包外的文件。

公开仓库：<https://github.com/Maybe-Zero-not-one/firefox-split-proxy>
（`src/` 就是这 8 个文件，`test/` 是回归测试，不参与打包）

## 可选：跑测试

```powershell
node test/match.test.mjs      # 48 条 · 规则引擎纯函数
node test/static.test.mjs     # 37 条 · manifest / 语法 / id 一致性 / web-ext lint
node test/live.test.mjs       # 10 条 · 需要本机 Firefox 与一个本地代理端口
```

`live.test.mjs` 需要本机跑着代理工具（默认 `127.0.0.1:7897`），审核时**不需要跑它**——
它验证的是「规则内的站真的进了代理、规则外的真的直连」，与代码正确性无关，只是我们的自测。

`static.test.mjs` 里的 `web-ext lint` 与 AMO 用的是同一套校验器，当前结果：
**0 error / 0 notice / 0 warning**。

## 源码里没有需要「还原」的东西

- 无 `eval` / `new Function` / `Function()` 构造
- 无远程脚本、无远程配置、无 CDN
- 无混淆、无压缩（`bg.js` 5.4 KB、`match.js` 4.7 KB，全是带注释的普通 JS）
- `icon.svg` 是手写的内联 SVG，不是生成的位图
