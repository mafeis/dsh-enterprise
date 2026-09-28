		/* ============ 企业管控：屏蔽官方「插件」页的「添加插件」入口 ============
		   官方插件页（@deepseek-ai/dsh-client-ui-plugin-manager）头部只有两个按钮：
		     <section data-plugin-panel><header data-window-drag> … <div class=toolbar>
		       <button aria-label="刷新">…</button>   <button>添加插件</button>
		   「添加插件」是终端自助装插件的唯一入口（openInstall 只有它调用），企业侧不允许随意安装：
		   node 半区已有白名单 + 清单外插件自动卸载兜底，这里负责摘掉入口本身。
		   判定：主判 CSS（header 内唯一没有 aria-label 的按钮）+ 文案兜底（官方改版补 aria-label 也能摘）。
		   放开条件：网关策略 allowPluginInstall === true（管理台 PATCH /admin/policy
		   {"policy":{"allowPluginInstall":true}}），拉不到策略一律按禁装处理。 */

		const PLUGIN_LOCK_STYLE_ID = "enterprise-plugin-lock-style";
		const PLUGIN_LOCK_HEADER = "[data-plugin-panel] header";
		const PLUGIN_LOCK_TEXT = /添加插件|查看安装任务|Add plugin|Install task/i;

		function entPluginLockApply(blocked) {
			let st = document.getElementById(PLUGIN_LOCK_STYLE_ID);
			if (!blocked && st) { st.remove(); st = null; }
			if (blocked && !st) {
				st = document.createElement("style");
				st.id = PLUGIN_LOCK_STYLE_ID;
				// 只摘头部按钮：刷新按钮带 aria-label，添加插件只有文字 → :not([aria-label]) 精确命中
				st.textContent = PLUGIN_LOCK_HEADER + " button:not([aria-label]){display:none !important;}";
				document.head.appendChild(st);
			}
			// 文案兜底：官方若改了头部结构（补 aria-label / 换容器），按文案再摘一次
			for (const btn of document.querySelectorAll(PLUGIN_LOCK_HEADER + " button")) {
				if (!PLUGIN_LOCK_TEXT.test(btn.textContent || "")) continue;
				btn.style.display = blocked ? "none" : "";
			}
		}

		function entPluginLockWatch(cleanups) {
			let blocked = true;              // 默认禁装：策略拉不到也按禁装处理
			let queued = false;
			const scan = () => {
				if (queued) return;
				queued = true;
				requestAnimationFrame(() => { queued = false; entPluginLockApply(blocked); });
			};
			const pull = async () => {
				try {
					const r = await apiGet("/api/enterprise/policy");
					if (r && r.ok && r.policy) blocked = r.policy.allowPluginInstall !== true;
				} catch { /* 策略拉不到：维持禁装 */ }
				entPluginLockApply(blocked);
			};
			const mo = new MutationObserver(scan);
			mo.observe(document.body, { childList: true, subtree: true });
			cleanups.push(() => mo.disconnect());
			const timer = setInterval(() => void pull(), 60000);
			cleanups.push(() => clearInterval(timer));
			entPluginLockApply(blocked);
			void pull();
		}
