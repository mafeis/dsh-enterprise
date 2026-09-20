		/* ============ 插件入口：登录遮罩 + 设置面板注册 + 模型页隐藏 ============ */

		/* 企业管理导航图标：公文包轮廓（stroke=currentColor，随宿主选中态变色；样式对齐宿主 16px 1.25 描边）。
		 * 宿主 SettingsRoot.navIcon 按 section id 硬编码映射、未知 id 一律回退设置齿轮，slot 注册项暂无 icon 字段，
		 * 故在 scan() 里按分区标签文本定位按钮后整只替换 svg；data-ent-icon 防重入（替换动作会再触发 MutationObserver）。 */
		const ENT_NAV_ICON_SVG = '<svg data-ent-icon="1" width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">'
			+ '<rect x="1.5" y="5" width="13" height="8.5" rx="1.5" stroke="currentColor" stroke-width="1.25"/>'
			+ '<path d="M5.5 5V3.9c0-.77.63-1.4 1.4-1.4h2.2c.77 0 1.4.63 1.4 1.4V5" stroke="currentColor" stroke-width="1.25" stroke-linecap="round"/>'
			+ '<rect x="6.75" y="8" width="2.5" height="2" rx="0.5" stroke="currentColor" stroke-width="1.25"/>'
			+ '</svg>';

		function swapEntNavIcon(btn) {
			const svg = btn.querySelector("svg");
			if (!svg || svg.dataset.entIcon === "1") return;
			const tpl = document.createElement("template");
			tpl.innerHTML = ENT_NAV_ICON_SVG;
			const next = tpl.content.firstElementChild;
			const cls = svg.getAttribute("class");
			if (cls) next.setAttribute("class", cls);   // 保留宿主 navIcon 样式类（CSS module 哈希名，不能硬编码）
			svg.replaceWith(next);
		}

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
					void checkUpdateBanner();
				}, 5000);
				cleanups.push(() => clearInterval(overlayWatch));
				void checkViolationOverlay();
				void checkUpdateBanner();
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
								continue;
							}
							// 顺手换图标：宿主 navIcon 按 section id 映射、未知 id 落齿轮兜底（slot 注册项暂无 icon 字段），
							// "企业管理" 撞了通用设置的齿轮——按标签文本定位本插件按钮，把兜底齿轮换成公文包轮廓
							if (txt === t2("企业管理", "Enterprise")) swapEntNavIcon(btn);
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
