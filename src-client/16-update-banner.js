		/* ============ 插件自动更新提示（非阻断：右下角提示条，重启后解除） ============ */
		/* /api/enterprise/status 的 pluginGovernance.updatePending 非空（本次进程启动后
		 * 自动更新装好了新版本）→ 右下角提示「重启后生效」，带立即重启按钮。 */

		function mountUpdateBanner(pending) {
			if (document.getElementById("enterprise-update-banner")) return;
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
<div class="msg">${t2("企业插件已更新到", "Enterprise plugin updated to")} <strong>${String(pending.version || "").replace(/</g, "&lt;")}</strong>${t2("，重启后生效", " — restart to apply")}</div>
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
				const up = s?.pluginGovernance?.updatePending;
				if (up && up.version) mountUpdateBanner(up);
			} catch { /* 网络抖动：下轮再看 */ }
		}
