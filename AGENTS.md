# AGENTS.md · dsh-enterprise(企业客户端插件)

> 面向在本仓库工作的 AI 助手的强制性规则。面向人的架构文档见 [docs/客户端插件核心文档.md](docs/客户端插件核心文档.md)。本文件与其冲突时,以本文件为准。

## 术语规范

- 界面文案与代码注释使用中性用语:**用户端/用户**;禁止引入「员工/employee/老板」等带等级色彩的称谓(全仓已清零)
- 界面双语实现:本仓库不存在 `T()`;使用 `t2()`(非 React)/`useT2()`(React),跟随宿主 `<html lang>`
- 与服务器比较或上报的字符串(枚举值、规则值)**不得包裹 i18n 函数**

## 强制规则(违反将导致返工或事故)

1. **`lib/` 全部为构建产物**。修改 lib 将在 `node build.mjs` 时被覆盖;源码一律位于 `src-node/` 与 `src-client/`
2. **修改代码后必须执行** `node build.mjs && node --test "test/*.test.mjs"`(约 3 秒,零 npm 依赖);全部测试通过方可视为完成
3. **`file:` 安装为复制而非引用**:源码变更后在测试实例必须执行 `remove` + `add` 重装;仅改源码不重装,实例运行的仍是旧代码
4. **ENT_SETTINGS_PATH 红线**:测试实例启动脚本必须携带该变量;缺失时插件将读写共享的 `~/.dsh/settings.yaml`,污染生产 Desktop 配置
5. **生产 Desktop 实例(43120)禁止触碰**:插件更新后需用户主动重启方可生效;未经用户明确要求,严禁重启、测试或终止进程。测试一律使用 43122 测试实例
6. **禁止以正则内联方式修改 settings.yaml**:须编写临时 `.mjs` 脚本以 node 执行,禁止在 PowerShell 中内联复杂正则;修改后执行 `node --check`,并以单元测试覆盖三种状态(块存在/已为空/空行)
7. **YAML 重复键**:向段内插入 `providers:` 等键之前必须检查其是否已存在
8. **官方模型屏蔽段必须覆盖双路径**:登录与登出均须保证 `llm-deepseek: models: []`;遗漏任一路径,将在登出→重登循环后导致官方模型泄漏至选择器
9. **provider 段校验红线**:模型 `input` 仅允许 `text`/`image`;`reasoningEfforts` 必须为 dict 格式(`off: none`、`low: low`),非思考模型应省略该字段;违反将导致 ns 不注册、企业模型全部消失且无显式报错
10. **UI 与日志不得输出具体模型名**(企业安全要求,面板/登录成功消息/水印均不包含);`/admin/config` 返回的 `hasKey`/`apiKeyDirect` 为布尔值,不得当作密钥原文使用
11. **build.mjs 禁用 cpSync/rmSync**:本机 Node 22.20 的递归调用会崩溃(0xC0000409),使用手写递归实现,不得"优化"改回
12. **企业 block-url 规则会扫描 Agent 工具参数**:测试代码中构造被禁域名必须使用字符串拼接,禁止写出完整被禁域名(写入动作会被规则引擎拦截,曾有真实事故)
13. **发版版本号两处同步修改**:`package.json` 与 `src-node/shared/version.js`
14. **原子写**:所有落盘操作必须经由 `writeTextAtomic`(shared/fs-utils),不得使用裸 writeFileSync
15. **UI 色值一律走 `--ent-*` 语义令牌**:浏览器半区禁止出现硬编码色值,须引用 `src-client/40-theme.js` 中 `THEME_CSS` 声明的令牌(浅色在 `body`、深色覆盖在 `body[data-ds-dark-theme]`;宿主 `--dsw-alias-*` 声明在 body,写成 `:root` 取不到)。违反将被 `test/theme-tokens.test.mjs` 拦下;深色模式不可读的历史事故:0.9.6 及以前
16. **共享可变状态各归其主**:心跳状态在 `heartbeat/`、策略缓存在 `policy/`、规则计数在 `rules/engine`;跨模块访问一律经由取值函数(如 `currentHeartbeatState()`)

## 代码地图(修改目标 → 位置)

| 修改内容 | 位置 |
| --- | --- |
| 登录/模型配置写入 | `src-node/auth/`(login.js:mapGatewayModels 模态白名单、repairConfigure) |
| 登出/清场 | `src-node/auth/logout.js`(`/api/enterprise/logout` 与心跳 401 自动清场共用同一实现) |
| 心跳/续期/指纹联动 | `src-node/heartbeat/` |
| 插件管控清理 | `src-node/enforce/plugin-enforce.js` |
| 策略拉取/企业插件源 | `src-node/policy/` |
| URL/DLP/高危命令规则 | `src-node/rules/engine.js`(纯函数)+ `hooks.js`(宿主钩子) |
| settings.yaml 行级改写 | `src-node/settings/yaml-edit.js`(修改前先阅读 `test/yaml-edit.test.mjs`,历史事故多发区已有回归保护) |
| provider/凭证写入 | `src-node/settings/provider-config.js` |
| 全部落盘路径 | `src-node/shared/paths.js`(唯一定义处) |
| 状态文件 | `src-node/state/state.js`(`enterprise-state.json`,含旧版迁移) |
| 浏览器 UI(遮罩/面板/水印/横幅) | `src-client/`(数字前缀决定拼接顺序,各片段共享同一工厂作用域) |
| 配色/深色模式令牌 | `src-client/40-theme.js` 的 `THEME_CSS`(全仓唯一允许出现色字面量之处) + `mountThemeStyle()` |
| 路由(loopback) | `src-node/web/routes.js`(16 条 /api/enterprise/* + /plugins/enterprise 登录页) |

## 调试速查(现象 → 排查方向)

| 现象 | 排查方向 |
| --- | --- |
| 登录成功但模型选择器无企业模型 | `settings/describe` 有无 provider ns → 校验红线(input 白名单/reasoningEfforts dict) |
| 模型间歇性消失 | 心跳 modelFingerprint 触发的 repairConfigure;状态文件快照 |
| 官方 deepseek 混入列表 | 屏蔽段双路径(登录与登出) |
| 测试实例更新后无变化 | 未执行 remove+add 重装 |
| 心跳 401 | 续期逻辑与 `.credentials.yaml`;连续 2 次 401 将自动清场(设计行为) |
| 插件写入错误的 settings 文件 | ENT_SETTINGS_PATH 与 profile 的 cordis.patch.yml 指向是否一致 |

## 背景机制速记(细节见核心文档)

- 心跳在线窗口为 3 分钟(`ceil(130/60)` 进位);心跳表时间列存储 UTC,查询使用 `datetime(ts, '+8 hours')`
- 终端聚合分区键为 (device_hash, account);同机多实例按账号独立展示属设计行为
- 插件管控:网关 `allowedPlugins` 非空即启用;保护名单 `dsh-enterprise` / `@deepseek-ai/dsh-base` / `@deepseek-ai/dsh-web-app` 永不清理
- 清理移除的是"下次启动不再加载";当前会话内已加载的 bundle 无法卸载(ESM 无运行时卸载机制),UI 将提示重启后完全退出
