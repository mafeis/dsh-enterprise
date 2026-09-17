<div align="center">
  <img src="assets/logo.svg" width="128" alt="dsh-enterprise logo">

  # dsh-enterprise

  **DSH 企业版客户端插件 · DSH Enterprise Client Plugin**

  统一企业登录 · 模型自动配置 · 策略治理
  Unified sign-in · Auto model provisioning · Policy governance

  ![License](https://img.shields.io/badge/license-MIT-blue)
  ![Node](https://img.shields.io/badge/node-22.19%2B%20%7C%7C%2024%2B-339933?logo=node.js&logoColor=white)
  ![Dependencies](https://img.shields.io/badge/dependencies-0-brightgreen)
  ![Platform](https://img.shields.io/badge/platform-DSH%20Desktop-818cf8)

  [简体中文](#-简体中文) · [English](#-english)
</div>

---

## 🇨🇳 简体中文

### 它解决了什么问题

装了 DSH 终端的用户电脑上，模型要自己配：填地址、贴密钥、选默认模型——配错一个就用不了，改一次密码就得挨台重配。管理员对终端也没有约束力：想强制登录、想下架某个插件、想拦住敏感内容外发，全都做不到。

这个插件装进用户 DSH 终端后，一条龙解决：

- **用户只登录一次** — 账号密码换企业令牌，模型列表、默认模型、凭证全部自动配好，登录即可用；配置坏了在设置页一键修复
- **终端始终与服务器对齐** — 登录、修复、启动对账三条路保障终端模型列表与企业目录一致
- **策略自动下发** — 服务器下发的策略（心跳开关、插件管控、内容规则）在终端自动生效，支持灰度与回执
- **插件管控** — 自动清理企业允许清单之外的插件，提供企业插件市场统一安装入口
- **未登录即阻断** — 可开启强制登录，不登录不让用
- **敏感内容拦截** — URL 拦截与文本 DLP 规则在终端侧生效，带命中记录

### 功能一览

| 功能 | 说明 |
| --- | --- |
| 企业登录 | 内置登录页，登录成功自动写模型配置与凭证 |
| 一键修复 | 配置异常时重建 Provider / 模型 / 凭证 |
| 策略心跳 | 定期上报设备状态、续期令牌，断网用本地缓存保底 |
| 策略灰度 | 拉取最新策略 → 缓存 → 回执，管理员可见推进度 |
| 插件管控 | 允许清单之外的插件启动即清理；企业市场安装 |
| 规则引擎 | URL 拦截 / 文本 DLP 本地判定，宿主钩子执行 |

### 环境要求

| 依赖 | 版本 / 说明 |
| --- | --- |
| DSH Desktop | 任意支持插件的版本 |
| Node.js | 仅从源码构建时需要 `^22.19.0` / `>=24.0.0`；npm 安装无需单独准备 |
| npm 依赖 | **零依赖** — 构建脚本与运行时都不装任何包 |
| 插件权限 | `fs:read` / `fs:write` / `net:loopback`（仅访问本机回环地址） |

### 安装

一条命令，从 npm 安装（推荐）：

```powershell
dsh plugin add dsh-enterprise
```

装好后打开 DSH 终端，登录页在 `/plugins/enterprise`——用户输入企业账号密码即可，不需要手动填任何地址或密钥。

### 从源码构建（开发者）

```powershell
git clone https://github.com/mafeis/dsh-enterprise.git
cd dsh-enterprise
node build.mjs                        # 构建 → lib/
dsh plugin add file:./
node --test "test/*.test.mjs"         # 单元测试
node test/test-enforce.mjs            # 插件管控端到端冒烟
```

## 🇬🇧 English

### What problem does it solve

On user machines running DSH, models must be configured by hand: enter the endpoint, paste the key, pick a default model — one typo and nothing works, and every password change means reconfiguring every machine. Admins have no leverage over terminals either: enforcing sign-in, disabling a plugin, or blocking sensitive content from leaving are all impossible.

Install this plugin into the user's DSH terminal and all of it just works:

- **One sign-in, everything configured** — credentials are exchanged for an enterprise token; model list, default model and credentials are written automatically. Broken config? One-click repair in the settings panel
- **Terminals stay in sync** — sign-in, repair and startup reconciliation keep the terminal's model list aligned with the enterprise catalog
- **Policy delivered automatically** — server-side policies (heartbeat, plugin governance, content rules) take effect on the terminal, with staged rollout and acknowledgements
- **Plugin governance** — plugins outside the enterprise allowlist are cleaned up on startup; an enterprise marketplace provides a single install source
- **No sign-in, no usage** — mandatory sign-in can be enforced
- **Sensitive content blocking** — URL interception and text DLP rules run locally, with hit records

### Features

| Feature | Description |
| --- | --- |
| Enterprise sign-in | Built-in login page; model config and credentials written automatically |
| One-click repair | Rebuilds provider / models / credentials when config goes wrong |
| Policy heartbeat | Periodic device report and token renewal; local cache keeps things running offline |
| Staged rollout | Fetch → cache → ack, so admins can see rollout progress |
| Plugin governance | Non-allowlisted plugins removed on startup; enterprise marketplace installs |
| Rules engine | Local URL / text DLP evaluation, enforced via host hooks |

### Requirements

| Dependency | Version / Notes |
| --- | --- |
| DSH Desktop | Any version that supports plugins |
| Node.js | Only needed when building from source: `^22.19.0` / `>=24.0.0`; the npm install needs no extra setup |
| npm packages | **Zero dependencies** — neither build script nor runtime installs anything |
| Plugin permissions | `fs:read` / `fs:write` / `net:loopback` (loopback only) |

### Installation

One command, from npm (recommended):

```powershell
dsh plugin add dsh-enterprise
```

Once installed, open the DSH terminal and go to `/plugins/enterprise` — users just enter their enterprise account and password; no endpoint or key to fill in by hand.

### Build from source (developers)

```powershell
git clone https://github.com/mafeis/dsh-enterprise.git
cd dsh-enterprise
node build.mjs                        # Build → lib/
dsh plugin add file:./
node --test "test/*.test.mjs"         # Unit tests
node test/test-enforce.mjs            # End-to-end smoke test
```

---

## 🔗 Related / 相关项目

- [dsh-enterprise-gateway](https://github.com/mafeis/dsh-enterprise-gateway) — 企业网关服务端 · Enterprise gateway server (this plugin pairs with it · 插件与之配对使用)

## 📄 License

[MIT](LICENSE)
