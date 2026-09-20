		/* ============ 企业管控横幅：原生 DOM 注入（不依赖宿主 slot/React 渲染链路） ============
		   数据源：宿主 /api/enterprise/rules 命中记录（模型零感知）
		   - block：红色，消息被拦截
		   - warn ：橙色，消息已发出仅提醒
		   及时性：800ms 轮询；启动后首轮发现的"新"命中（15s 内）也弹出 */

		const __entBanner = { firstPoll: true, el: null, shown: new Set(), gateway: null };

		function entBannerRemove() {
			if (__entBanner.el) { __entBanner.el.remove(); __entBanner.el = null; }
		}

		function entBannerShow(hit) {
			entBannerRemove();
			const blocked = !!hit.blocked;
			const isNotice = hit.kind === "notice";
			// 样式可配置：规则的 style 字段（管理后台下发）覆盖默认——支持 position/top/left/right/
			// maxWidth/bg/border/color/width，JSON 或字符串均可，坏值忽略用默认
			let cfg = {};
			// 样式来源优先级：规则自带 style > 网关全局（管理台横幅样式面板） > 默认
			const ruleStyle = hit.style ?? null;
			const gw = __entBanner.gateway ?? {};
			const gwCfg = { ...(gw.style ?? {}), ...(gw.position ? { position: gw.position } : {}) };
			const src = ruleStyle ?? (Object.keys(gwCfg).length ? gwCfg : null);
			try { cfg = (typeof src === "string" ? JSON.parse(src) : src) || {}; } catch { cfg = {}; }
			cfg = (cfg && typeof cfg === "object") ? cfg : {};
			const px = (v, dflt) => (typeof v === "number" && v >= 0 ? v + "px" : typeof v === "string" && /^[\w.%+-]+$/.test(v) ? v : dflt);
			const col = (v, dflt) => (typeof v === "string" && /^#[0-9a-fA-F]{3,8}$/.test(v) ? v : dflt);
			// 位置：按 position 选锚点；top/left/right/bottom 边距用面板配置值（px 函数给默认），top-center 保持水平居中只吃 top 边距
			const pos = cfg.position === "top-center" ? "top:" + px(cfg.top, "14px") + ";left:50%;transform:translateX(-50%);"
				: cfg.position === "bottom-right" ? "bottom:" + px(cfg.bottom, "14px") + ";right:" + px(cfg.right, "18px") + ";"
					: cfg.position === "top-left" ? "top:" + px(cfg.top, "14px") + ";left:" + px(cfg.left, "18px") + ";"
						: "top:" + px(cfg.top, "14px") + ";right:" + px(cfg.right, "18px") + ";";   // 默认 top-right
			// 颜色不跟随网关全局配置：公告=蓝、拦截=红、提醒=橙，三种语义固定区分，避免同色混淆
			const cMain = isNotice ? "var(--ent-notice)" : blocked ? "var(--ent-bad-strong)" : "var(--ent-warn)";
			const cBg = isNotice ? "var(--ent-notice-tint)" : blocked ? "var(--ent-bad-tint)" : "var(--ent-warn-tint)";
			const cBorder = isNotice ? "var(--ent-notice-line)" : blocked ? "var(--ent-bad-line)" : "var(--ent-warn-line)";
			const el = document.createElement("div");
			el.setAttribute("data-enterprise-banner", "1");
			el.style.cssText = "position:fixed;" + pos + "z-index:2147483000;"
				+ "max-width:" + px(cfg.maxWidth, isNotice ? "460px" : "420px") + ";"
				+ "padding:11px 40px 11px 16px;border-radius:10px;"
				+ "background:" + cBg + ";border:1.5px solid " + cBorder + ";"
				+ "box-shadow:var(--ent-shadow-soft);font-family:inherit;font-size:13.5px;line-height:1.55;color:var(--ent-fg)";
			const btn = document.createElement("button");
			btn.textContent = "×";
			btn.title = t2("关闭", "Close");
			btn.style.cssText = "position:absolute;top:8px;right:10px;border:none;background:transparent;cursor:pointer;"
				+ "font-size:16px;line-height:1;padding:2px 4px;color:var(--ent-close)";
			btn.onmouseenter = () => { btn.style.color = "var(--ent-close-hover)"; };
			btn.onmouseleave = () => { btn.style.color = "var(--ent-close)"; };
			btn.onclick = () => entBannerRemove();
			// 公告：蓝色信息条，单行（图标 + 正文），与提醒/拦截同构
			if (isNotice) {
				const row = document.createElement("div");
				row.style.cssText = "display:flex;align-items:flex-start;gap:8px;word-break:break-word;max-height:132px;overflow-y:auto";
				const icon = document.createElement("span");
				icon.style.cssText = "flex-shrink:0;font-size:16px;line-height:1.4";
				icon.textContent = "📢";
				row.appendChild(icon);
				const text = document.createElement("span");
				text.style.cssText = "color:" + cMain;
				text.textContent = String(hit.message || "");
				row.appendChild(text);
				el.appendChild(row);
				el.appendChild(btn);
				document.body.appendChild(el);
				__entBanner.el = el;
				return;
			}
			// 单行布局：图标 + 提示语（关键词加粗）。管理员提示语含 [] 占位符时已填词；无占位符时补触发词。
			const row = document.createElement("div");
			row.style.cssText = "display:flex;align-items:flex-start;gap:8px;word-break:break-word;max-height:132px;overflow-y:auto";
			const icon = document.createElement("span");
			icon.style.cssText = "flex-shrink:0;font-size:16px;line-height:1.4";
			icon.textContent = blocked ? "⛔" : "⚠️";
			row.appendChild(icon);
			const text = document.createElement("span");
			const word = hit.matched || (hit.kind === "url" ? t2("受限网址", "Restricted URL") : t2("敏感词", "Sensitive word"));
			const msgStr = String(hit.message || "");
			// 提示语里已含触发词：整句显示，仅关键词加粗
			if (msgStr.includes(word)) {
				const idx = msgStr.indexOf(word);
				if (idx > 0) text.appendChild(document.createTextNode(msgStr.slice(0, idx)));
				const bold = document.createElement("b");
				bold.textContent = word;
				text.appendChild(bold);
				if (idx + word.length < msgStr.length) text.appendChild(document.createTextNode(msgStr.slice(idx + word.length)));
			} else {
				// 无 [] 占位符：提示语在前，命中词加粗放末尾（与 URL 分支一致，避免词悬在句首很怪）
				text.appendChild(document.createTextNode(msgStr || (hit.kind === "url" ? t2("该网址受企业规则管控", "This URL is restricted by enterprise rules") : t2("检测到敏感内容", "Sensitive content detected"))));
				if (word) {
					text.appendChild(document.createTextNode(t2("（", " (")));
					const bold = document.createElement("b");
					bold.textContent = word;
					text.appendChild(bold);
					text.appendChild(document.createTextNode(t2("）", ")")));
				}
			}
			text.style.cssText = "color:" + cMain;
			row.appendChild(text);
			el.appendChild(row);
			// 不显示消息原文：内容是用户刚输入的（自己最清楚）；留痕在管理台命中记录里
			el.appendChild(btn);
			document.body.appendChild(el);
			__entBanner.el = el;
		}

		// 公告检查：策略里的 type:"notice" 规则——进入页面即弹，弹一次；
		// 已读记录存 localStorage（公告内容变了才重新弹）
		// 另有网关 licenseNotice（商业授权超限公告）：登录成功即写入 sessionStorage，
		// reload 后第一时间弹出；每轮轮询发现未展示的同款也再弹——它是"每次登录必现"
		// 的隐藏公告，不写 localStorage 已读记录，也不出现在管理台公告编辑里
		async function entNoticeCheck() {
			try {
				// 优先：授权超限公告（每次登录必弹；同屏只留一条）
				const licNotice = sessionStorage.getItem("ent-license-notice");
				if (licNotice) {
					sessionStorage.removeItem("ent-license-notice");
					entBannerShow({ kind: "notice", matched: t2("授权提醒", "License notice"), message: licNotice, style: null, blocked: false });
					return;
				}
				const r = await fetch("/api/enterprise/policy");
				if (!r.ok) return;
				const d = await r.json();
				const pol = d.policy ?? d;
				if (pol.licenseNotice) {
					// 轮询中网关新报超限（如管理员刚停用授权码）：同样立即弹
					entBannerShow({ kind: "notice", matched: t2("授权提醒", "License notice"), message: String(pol.licenseNotice), style: null, blocked: false });
					return;
				}
				const notices = (pol.clientRules || []).filter((x) => x.type === "notice");
				for (const n of notices) {
					const key = "ent-notice-seen:" + (n.id ?? "") + ":" + String(n.value ?? "");
					if (localStorage.getItem(key)) continue;
					localStorage.setItem(key, "1");
					entBannerShow({ kind: "notice", matched: "企业公告", message: String(n.value ?? ""), style: n.style ?? null, blocked: false });
					break;   // 一次只弹一条，剩余的下次进入再弹
				}
			} catch { /* 网络抖动下轮再取 */ }
		}

		function registerWarnBanner(ctx, cleanups) {
			// 启动即拉一次网关全局样式（先于公告弹出，避免首个横幅拿不到位置按默认弹）
			void (async () => {
				try {
					const r = await fetch("/api/enterprise/rules");
					if (!r.ok) return;
					const d = await r.json();
					if (d.gatewayBannerStyle !== undefined || d.gatewayBannerPosition !== undefined) {
						__entBanner.gateway = { style: d.gatewayBannerStyle ?? null, position: d.gatewayBannerPosition ?? null };
					}
				} catch { /* 拉不到则本轮用默认，下轮同步 */ }
			})();
			// 公告时序：启动 600ms 后立即查一次（进入即弹/登录 reload 后 sessionStorage 有存货则必弹），
			// 之后每 5 分钟查一次（公告更新或新超限则再弹）
			const noticeFirst = setTimeout(() => { void entNoticeCheck(); }, 600);
			const noticePoll = setInterval(() => { void entNoticeCheck(); }, 5 * 60 * 1000);
			cleanups.push(() => { clearTimeout(noticeFirst); clearInterval(noticePoll); entBannerRemove(); });
			// 命中轮询（800ms）；逐条消费未展示过的命中（时间正序），
			// 屏幕上保留最新一条，其余被替换（点 × 关闭当前）。warn 不会因 block 更新而被挤掉。
			const poll = setInterval(async () => {
				try {
					const r = await fetch("/api/enterprise/rules");
					if (!r.ok) return;
					const d = await r.json();
					// 顺带同步网关全局横幅样式（管理台随时改，下一次弹出即生效）
					if (d.gatewayBannerStyle !== undefined || d.gatewayBannerPosition !== undefined) {
						__entBanner.gateway = { style: d.gatewayBannerStyle ?? null, position: d.gatewayBannerPosition ?? null };
					}
					const hits = (d.hits || []).filter((h) => (h.kind === "word" || h.kind === "url") && h.at);
					if (!hits.length) return;
					// hits 是新→旧；转成旧→新逐条处理
					const ordered = [...hits].reverse();
					if (__entBanner.firstPoll) {
						// 启动首轮：只弹 15 秒内的命中，更早的历史命中标记为已展示（静默记位）
						__entBanner.firstPoll = false;
						for (const h of ordered) {
							const ageMs = Date.now() - new Date(h.at).getTime();
							if (ageMs > 15000) __entBanner.shown.add(h.at);
						}
					}
					// 找第一条未展示过的（旧→新），展示后标记；下一轮继续处理剩下的
					const next = ordered.find((h) => !__entBanner.shown.has(h.at));
					if (!next) return;
					__entBanner.shown.add(next.at);
					entBannerShow(next);
				} catch { /* 网络抖动下轮再取 */ }
			}, 800);
			cleanups.push(() => { clearInterval(poll); entBannerRemove(); });
		}
