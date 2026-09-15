# 企业版-插件（dsh-enterprise）

DSH 企业版客户端插件：统一企业登录、模型网关自动配置、策略治理。装在员工 DSH 终端里，与网关（`dsh-enterprise-gateway`）配对使用。

## 功能

| 能力 | 说明 |
| --- | --- |
| 企业登录 | 内置登录页（`/plugins/enterprise`），账号密码换网关 JWT；登录成功自动写 `enterprise-settings.yaml`（providers + models + 默认模型）与 `.credentials.yaml`，终端立即可用企业模型 |
| 网关供给 | 登录/修复/启动对账三条路保障终端模型列表与网关一致（模型指纹比对，改了就修） |
| 策略心跳 | 定期上报 `{profile, env, policyVersion, device}`，令牌续期；服务端不可达用本地缓存保底 |
| 策略拉取 | `/policy/current` → 缓存快照 + 回执 `/policy/ack`（管理台看灰度进度） |
| 插件管控 | 启动 4s 后按网关允许清单自动清理清单外插件（manifest 移除）；企业插件市场 + 企业插件源安装 |
| 规则引擎 | URL 拦截/文本 DLP 规则在终端侧生效（host 拦截钩子 + 自检） |
| 强制登录 | `enforce/`：未登录阻断使用 |

## HTTP 路由（挂在 DSH Host webserver，仅回环）

```
GET  /plugins/enterprise               内置登录页
GET  /api/enterprise/status            当前配置状态（合规·规则统计）
POST /api/enterprise/login             登录并自动配置
POST /api/enterprise/logout            清场登出（吊销远端 + 清本地）
GET  /api/enterprise/models            企业模型目录（网关实时，缓存兜底）
POST /api/enterprise/repair            一键配置 Provider
POST /api/enterprise/heartbeat-config  心跳开关/间隔
POST /api/enterprise/heartbeat-now     立即心跳
GET  /api/enterprise/policy            网关下发策略（只读透传）
GET  /api/enterprise/usage?days=       我的消耗（透传网关计费）
GET  /api/enterprise/market            企业插件市场
POST /api/enterprise/plugin-install    安装企业允许清单内的插件
GET  /api/enterprise/plugin-registry   企业插件源配置
GET  /api/enterprise/rules             本机执行规则（统计+命中记录）
POST /api/enterprise/rules/check-url   试一试：网关是否被拦
POST /api/enterprise/rules/check-text  试一试：文本是否命中敏感词
GET  /api/enterprise/rules/self-test   规则钩子自检
```

## 目录

```
├── src-node/        # Node 半区（ESM，跑在 DSH 宿主进程）——改代码改这里
│   ├── index.js     #   插件入口（name/inject/apply）
│   ├── auth/        #   登录自动配置 + 一键修复
│   ├── enforce/     #   插件管控强制执行
│   ├── heartbeat/   #   心跳（增量上报/令牌续期/模型指纹联动）
│   ├── policy/      #   策略拉取缓存回执 + 企业插件源 + 市场元数据
│   ├── rules/       #   本地规则引擎（判定）+ 宿主拦截钩子（执行）
│   ├── settings/    #   settings.yaml 行级 YAML 改写 + provider/凭证写入
│   ├── web/         #   路由适配器 + 17 条 HTTP 路由（16 API + 登录页）+ 内置登录页
│   ├── device/ state/ shared/
├── src-client/      # 浏览器半区（DSH __ModuleLoader__ 模块），数字前缀控制拼接顺序
├── lib/             # 构建产物（build.mjs 生成，勿手改，不入库）
├── test/            # node --test 测试
└── build.mjs        # 零依赖构建：src-node 原样拷贝 → lib/，src-client 按序拼接 → lib/client.js
```

## 构建与测试

```powershell
node build.mjs                      # 构建 → lib/
node --test "test/*.test.mjs"       # 单元测试（15 项）
node test/test-enforce.mjs          # 插件管控端到端冒烟（假网关 + 假 profile）
```

改代码只改 `src-node/` 与 `src-client/`，改完跑 `node build.mjs`，重装插件（remove + add）生效。

## 安装到 DSH

```powershell
dsh plugin add file:./    # lib/ 是安装目录内容
```

## 与网关的对接端点

`/auth/login` · `/auth/refresh` · `/v1/models` · `/heartbeat` · `/policy/current` · `/policy/ack`（网关侧实现见 `dsh-enterprise-gateway` 仓库）

## 文档

- `docs/客户端插件核心文档.md` — 完整设计文档
