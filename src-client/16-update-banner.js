		/* ============ 插件更新提示（非阻断：右下角提示条，重启后解除） ============ */
		/* /api/enterprise/status 的 pluginGovernance.updatesPending 非空 = 本次进程启动之后
		 * 装好了新版本（本插件自更新，或面板「更新」按钮更新的其它插件）
		 * → 右下角提示「重启后生效」，带立即重启按钮。 */

		/** 一条提示覆盖三种情形：只更新了企业插件 / 更新了某个第三方插件 / 一次更新了好几个 */
		function bannerText(list) {
			const esc2 = (x) => String(x || "").replace(/</g, "&lt;");
			if (list.length > 1) {
				const names = list.map((x) => esc2(x.name)).slice(0, 3).join("、");
				const more = list.length > 3 ? "…" : "";
				return t2("已更新 ", "Updated ") + "<strong>" + list.length + t2(" 个插件", " plugins") + "</strong>（" + names + more + "）" + t2("，重启后生效", " — restart to apply");
			}
			const one = list[0] || {};
			if (one.name && one.name !== "dsh-enterprise") {
				return esc2(one.name) + t2(" 已更新到 ", " updated to ") + "<strong>" + esc2(one.version) + "</strong>" + t2("，重启后生效", " — restart to apply");
			}
			return t2("企业插件已更新到", "Enterprise plugin updated to") + " <strong>" + esc2(one.version) + "</strong>" + t2("，重启后生效", " — restart to apply");
		}

		function mountUpdateBanner(list) {
			if (document.getElementById("enterprise-update-banner")) return;
			list = Array.isArray(list) ? list.filter((x) => x && (x.version || x.name)) : (list ? [list] : []);
			if (!list.length) return;
			const el = document.createElement("div");
			el.id = "enterprise-update-banner";
			el.innerHTML = `
<style>
#enterprise-update-banner { position: fixed; right: 18px; bottom: 18px; z-index: 2147483000;
  background: var(--ent-box); border: 1px solid var(--ent-line); border-radius: 12px;
  padding: 12px 16px; box-shadow: var(--ent-shadow); color: var(--ent-fg); font-size: 13px;
  display: flex; align-items: center; gap: 10px; font-family: inherit; }
#enterprise-update-banner .msg strong { color: var(--ent-fg); }
#enterprise-update-banner button { padding: 6px 14px; font-size: 12.5px; border: none; border-radius: 8px;
  background: var(--ent-accent); color: var(--ent-accent-ink); cursor: pointer; font-family: inherit; white-space: nowrap; }
#enterprise-update-banner button:disabled { opacity: .6; cursor: default; }
#enterprise-update-banner .later { background: transparent; color: var(--ent-fg-2); border: 1px solid var(--ent-line); }
</style>
<div class="msg">${bannerText(list)}</div>
<button id="enterprise-update-restart">${t2("立即重启", "Restart now")}</button>
<button class="later" id="enterprise-update-later">${t2("稍后", "Later")}</button>`;
			document.body.appendChild(el);
			el.querySelector("#enterprise-update-restart").addEventListener("click", async (e) => {
				e.target.disabled = true;
				e.target.textContent = t2("正在重启…", "Restarting…");
				try {
					const r = await fetch("/api/desktop/restart", { method: "POST", headers: { "content-type": "application/json" }, body: "{}" });
					if (!r.ok) throw new Error(String(r.status));
				} catch { /* 接口不可用时退化为提示手动重启 */ }
				setTimeout(() => {
					const b = el.querySelector("#enterprise-update-restart");
					if (b) { b.disabled = false; b.textContent = t2("重启未响应 · 请手动重启", "Not responding · restart manually"); }
				}, 5000);
			});
			el.querySelector("#enterprise-update-later").addEventListener("click", () => el.remove());
		}

		/** 轮询入口：复用 99-entry 的遮罩轮询节奏（独立请求，频率低：30s 一次足够） */
		async function checkUpdateBanner() {
			if (document.getElementById("enterprise-update-banner")) return;
			try {
				const r = await fetch("/api/enterprise/status", { headers: { accept: "application/json" } });
				if (!r.ok) return;
				const s = await r.json();
				const g = s?.pluginGovernance;
				// 优先用带包名的清单（updatesPending，0.9.19+）；老网关/老状态没有就退回单条 updatePending
				mountUpdateBanner(Array.isArray(g?.updatesPending) && g.updatesPending.length ? g.updatesPending : (g?.updatePending ? [g.updatePending] : []));
			} catch { /* 网络抖动：下轮再看 */ }
		}
