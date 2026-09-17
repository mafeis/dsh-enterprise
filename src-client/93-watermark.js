		/* ============ 企业管控界面水印：用户端插件 Web 界面叠加半透明水印层 ============
		   数据源：/api/enterprise/policy 的 watermark 布尔（策略开关，管理台下发）
		   - 开启：全屏 pointer-events:none 重复文字层（登录账号 + 北京时间，分钟级刷新）
		   - 防删：MutationObserver 监听水印层被移除/style 被改 → 立即重建；策略关闭 → 撤层
		   - 目标：整个页面（截屏/录屏可溯源，不影响任何交互） */

		const __entWatermark = { el: null, on: false, user: "", mo: null, timer: null, device: "", style: null };

		// 样式默认值（管理台 watermarkStyle 可覆盖）
		const WM_STYLE_DEFAULTS = { template: "{user} · {time}", color: "#0f172a", opacity: 0.06, fontSize: 13, gapX: 260, gapY: 150, angle: -22 };

		function wmStyle() {
			return Object.assign({}, WM_STYLE_DEFAULTS, __entWatermark.style && typeof __entWatermark.style === "object" ? __entWatermark.style : {});
		}

		function entWatermarkText() {
			const d = new Date(Date.now() + (8 - (-new Date().getTimezoneOffset() / 60)) * 3600e3);
			const t = d.toISOString().slice(0, 16).replace("T", " ") + " (UTC+8)";
			const st = wmStyle();
			const loginAt = __entWatermark.loginAt ? String(__entWatermark.loginAt).slice(0, 16).replace("T", " ") : "";
			const vars = {
				"{user}": __entWatermark.user || t2("企业用户", "Enterprise user"),
				"{time}": t,
				"{device}": __entWatermark.device || "",
				"{loginAt}": loginAt,
				"{gateway}": __entWatermark.gateway || "",
			};
			let out = String(st.template ?? WM_STYLE_DEFAULTS.template);
			for (const k of Object.keys(vars)) out = out.split(k).join(vars[k]);
			return out;
		}

		function entWatermarkBuild() {
			const st = wmStyle();
			const el = document.createElement("div");
			el.setAttribute("data-enterprise-watermark", "1");
			el.style.cssText = "position:fixed;inset:0;z-index:2147482900;pointer-events:none;overflow:hidden;"
				+ "user-select:none;-webkit-user-select:none;opacity:" + Math.min(0.5, Math.max(0.01, Number(st.opacity) || WM_STYLE_DEFAULTS.opacity)) + ";transition:opacity .3s";
			const txt = entWatermarkText();
			const gx = Math.min(800, Math.max(80, Number(st.gapX) || WM_STYLE_DEFAULTS.gapX));
			const gy = Math.min(600, Math.max(50, Number(st.gapY) || WM_STYLE_DEFAULTS.gapY));
			const fs = Math.min(40, Math.max(8, Number(st.fontSize) || WM_STYLE_DEFAULTS.fontSize));
			const ang = Math.min(90, Math.max(-90, Number(st.angle) || 0)) || WM_STYLE_DEFAULTS.angle;
			const cols = Math.ceil((window.innerWidth || 1600) / gx) + 3;
			const rows = Math.ceil((window.innerHeight || 900) / gy) + 3;
			for (let row = -1; row < rows; row++) {
				for (let col = -1; col < cols; col++) {
					const s = document.createElement("span");
					s.textContent = txt;
					s.style.cssText = "position:absolute;white-space:nowrap;"
						+ "left:" + (col * gx + (row % 2) * Math.round(gx / 2)) + "px;top:" + (row * gy) + "px;"
						+ "transform:rotate(" + ang + "deg);font-size:" + fs + "px;font-weight:600;"
						+ "color:" + st.color + ";font-family:system-ui,sans-serif;letter-spacing:1px";
					el.appendChild(s);
				}
			}
			return el;
		}

		function entWatermarkMount() {
			if (__entWatermark.el) return;
			__entWatermark.el = entWatermarkBuild();
			document.body.appendChild(__entWatermark.el);
			// 定时器/观察器只建一次：mount 会被重建路径反复调用，重复建会泄漏堆叠拖死页面
			if (__entWatermark.mo) return;
			// 防删守护：水印层被移除或 style 被清 → 重建（用户无法靠控制台一键去水印）
			__entWatermark.mo = new MutationObserver(() => {
				if (!__entWatermark.on) return;
				const alive = document.querySelector('[data-enterprise-watermark="1"]');
				if (!alive) { __entWatermark.el = null; entWatermarkMount(); }
			});
			__entWatermark.mo.observe(document.body, { childList: true });
			// 时间戳分钟级刷新（重建整层，文案同步更新）
			__entWatermark.timer = setInterval(() => {
				if (!__entWatermark.on) return;
				const old = document.querySelector('[data-enterprise-watermark="1"]');
				if (old) old.remove();
				__entWatermark.el = null;
				entWatermarkMount();
			}, 60 * 1000);
		}

		function entWatermarkUnmount() {
			__entWatermark.on = false;
			__entWatermark.fp = null;
			__entWatermark.el?.remove();
			__entWatermark.el = null;
			__entWatermark.mo?.disconnect();
			__entWatermark.mo = null;
			clearInterval(__entWatermark.timer);
			__entWatermark.timer = null;
		}

		/** 策略轮询：watermark 状态变化即挂/撤（10s 轮询，轻量 GET） */
		function entWatermarkWatch(cleanups) {
			const tick = async () => {
				try {
					const r = await fetch("/api/enterprise/policy");
					if (!r.ok) return;
					const d = await r.json();
					const p = d.policy ?? d;
					const on = !!p?.watermark;
					const fp = JSON.stringify(p?.watermarkStyle ?? null);
					__entWatermark.style = p?.watermarkStyle ?? null;
					if (on && !__entWatermark.on) {
						__entWatermark.fp = fp;
						// 顺带拿登录账号/设备名（拿不到用兜底文案）
						try {
							const s = await (await fetch("/api/enterprise/status", { headers: { accept: "application/json" } })).json();
							__entWatermark.user = String(s.user ?? "");
							__entWatermark.device = String(s.deviceName ?? s.hostname ?? "");
							__entWatermark.loginAt = String(s.loginAt ?? "");
							__entWatermark.gateway = String(s.gateway ?? "");
						} catch {}
						__entWatermark.on = true;
						entWatermarkMount();
					} else if (on && __entWatermark.on) {
						// 样式热更：指纹没变不动（否则每 10s 重建一次纯浪费）
						if (fp === __entWatermark.fp) return;
						__entWatermark.fp = fp;
						const old = document.querySelector('[data-enterprise-watermark="1"]');
						if (old) old.remove();
						__entWatermark.el = null;
						entWatermarkMount();
					} else if (!on && __entWatermark.on) {
						entWatermarkUnmount();
					}
				} catch { /* 网络抖动下轮再看 */ }
			};
			void tick();
			const t = setInterval(tick, 10 * 1000);
			cleanups.push(() => { clearInterval(t); entWatermarkUnmount(); });
		}
