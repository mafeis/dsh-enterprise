		/* ============ 插件入口：登录遮罩 + 设置面板注册 + 模型页隐藏 ============ */

		function apply(ctx) {
			ctx.effect(() => {
				let disposed = false;
				const cleanups = [];

				(async () => {
					let status;
					try {
						const r = await fetch("/api/enterprise/status", { headers: { accept: "application/json" } });
						if (!r.ok) return;
						status = await r.json();
					} catch { return; }
					if (disposed) return;
					if (status.configured) return;
					// 企业管控：未配置一律锁定——无跳过路径，必须登录后才能使用
					mountLoginOverlay();
				})();

				// 登录遮罩热挂载：账号被网关停用/凭证被吊销时，插件心跳自动清场（configured 变 false），
				// 这里轮询发现后立即弹出全屏登录遮罩锁定操作。5s 轮询（原 30s：清场后遮罩要等很久才弹，
				// 手动点"立即检测"看到未登录提示后迟迟不弹框）。已挂出则跳过，开销可忽略。
				const overlayWatch = setInterval(async () => { void checkOverlay(); }, 5000);
				cleanups.push(() => clearInterval(overlayWatch));
				// 供其他模块在关键动作（立即检测/登出）后立即触发遮罩检查，不等下一轮轮询
				window.__enterpriseCheckOverlay = checkOverlay;
				cleanups.push(() => { delete window.__enterpriseCheckOverlay; });

				async function checkOverlay() {
					if (disposed) return;
					if (document.getElementById("enterprise-overlay")) return;
					try {
						const r = await fetch("/api/enterprise/status", { headers: { accept: "application/json" } });
						if (!r.ok) return;
						const s = await r.json();
						if (!disposed && s && !s.configured) void mountLoginOverlay();
					} catch { /* 网络抖动：下轮再看 */ }
				}

				// 注册设置面板：设置 → 企业管理（一级菜单，页内二级 tab：账号管理/插件管理/规则管理）
				try {
					ctx.effect(() => {
						ctx.slots.inject("settings.section", () => ctx.slots.register({
							name: "settings.section",
							id: "enterprise-admin",
							order: 13,
							label: () => "企业管理",
							inject: () => ({})
						}, () => reactJsx.jsx(EnterpriseAdminPanel, {})));
					}, "enterprise: enterprise admin section");
				} catch (e) {
					// slots 不可用（旧版本 host）：面板注册失败不影响遮罩
				}

				// 回复末尾企业提醒横幅：轮询 warn 命中 → turnTail 插槽（AI 回复正下方）显示（不进模型上下文）
				try {
					registerWarnBanner(ctx, cleanups);
				} catch (e) {
					// slots 不可用（旧版本 host）：横幅注册失败不影响其他功能
				}

				// 企业管控：只要插件在运行就隐藏设置里的「模型」页——模型只能通过企业账号配置。
				// 插件安装 = 隐藏生效；插件卸载 = 本代码不再运行，模型页自动恢复显示。
				// 实现：MutationObserver 监听设置面板导航，找到 label 为「模型」的 navCell 一律隐藏。
				try {
					const scan = () => {
						const navCells = document.querySelectorAll("nav button");
						for (const btn of navCells) {
							const label = btn.querySelector("span");
							if (label && label.textContent.trim() === "模型") {
								btn.style.display = "none";
							}
						}
					};
					const mo = new MutationObserver(() => scan());
					mo.observe(document.body, { childList: true, subtree: true });
					scan();
					cleanups.push(() => { mo.disconnect(); });
				} catch {}

				return () => { disposed = true; for (const c of cleanups) { try { c() } catch {} } };
			}, "enterprise: auto login overlay + settings section");
		}
