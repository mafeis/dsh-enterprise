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
				// 同一轮询顺带检查异常插件处置遮罩（清单外插件被自动卸载 → 全屏锁定要求重启）
				const overlayWatch = setInterval(() => {
					void checkOverlay();
					void checkViolationOverlay();
				}, 5000);
				cleanups.push(() => clearInterval(overlayWatch));
				void checkViolationOverlay();
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
							label: () => t2("企业管理", "Enterprise"),
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

				// 界面水印：策略 watermark:true 时全页面叠加账号+时间水印（防截屏外传无溯源）；10s 轮询开关状态
			try {
				entWatermarkWatch(cleanups);
			} catch (e) {
				// 水印失败不影响其他功能
			}

			// 企业管控：按网关策略隐藏设置页——模型页（lockModelConfig=true 固定藏）+ hiddenSettingsPages 清单（管理员按标签关键词配，双语关键词都写）。
				// 策略随 /api/enterprise/policy 60s 轮询刷新，宿主改名后管理员在网关加关键词即可，无需发版。
				// 插件安装 = 隐藏生效；插件卸载 = 本代码不再运行，隐藏页自动恢复显示。
				try {
					let policyLabels = new Set(["模型", "Models"]);   // 兜底：策略未拉到前先按默认锁模型页
					// 拉策略 → 组装要藏的标签集合
					const pullPolicy = async () => {
						try {
							const r = await apiGet("/api/enterprise/policy");
							if (r && r.ok && r.policy) {
								const p = r.policy;
								const labels = new Set();
								if (p.lockModelConfig !== false) { labels.add("模型"); labels.add("Models"); }
								for (const kw of (Array.isArray(p.hiddenSettingsPages) ? p.hiddenSettingsPages : [])) {
									const s = String(kw || "").trim(); if (s) labels.add(s);
								}
								policyLabels = labels;
							}
						} catch { /* 策略拉不到：沿用上一份 */ }
						scan();
					};
					const scan = () => {
						const navCells = document.querySelectorAll("nav button");
						for (const btn of navCells) {
							const label = btn.querySelector("span");
							const txt = label && label.textContent.trim();
							if (txt && policyLabels.has(txt)) {
								btn.style.display = "none";
							}
						}
					};
					const mo = new MutationObserver(() => scan());
					mo.observe(document.body, { childList: true, subtree: true });
					scan();
					cleanups.push(() => { mo.disconnect(); });
					void pullPolicy();
					const policyT = setInterval(() => void pullPolicy(), 60000);
					cleanups.push(() => clearInterval(policyT));
				} catch {}

				return () => { disposed = true; for (const c of cleanups) { try { c() } catch {} } };
			}, "enterprise: auto login overlay + settings section");
		}
