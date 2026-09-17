		/* ============ 异常插件处置遮罩（管控自动卸载后弹出，重启后解除） ============ */
		/* 与登录遮罩同哲学：全屏锁定、无跳过路径。触发条件 = /api/enterprise/status 里
		 * pluginGovernance.pendingRestart 非空（本次进程启动后发生过清单外插件清理）。
		 * 重启 DSH 后 cleanup.at 早于新进程启动时间 → pendingRestart 为 null → 遮罩不再弹出。 */

		function mountViolationOverlay(cleanup) {
			if (document.getElementById("enterprise-violation-overlay")) return;
			const names = (cleanup.names || []).join(t2("、", ", ")) || t2("未知插件", "Unknown plugin");
			const overlay = document.createElement("div");
			overlay.id = "enterprise-violation-overlay";
			overlay.innerHTML = `
<style>
#enterprise-violation-overlay { position: fixed; inset: 0; z-index: 2147483100; background: rgba(15,23,42,.55);
  display: flex; align-items: center; justify-content: center; backdrop-filter: blur(4px);
  font-family: -apple-system, "Segoe UI", "Microsoft YaHei", "PingFang SC", sans-serif; }
body[data-ds-dark-theme] #enterprise-violation-overlay { background: rgba(0,0,0,.62); }
#enterprise-violation-overlay .box { background: var(--ent-box); border: 1px solid var(--ent-line); border-radius: 14px; padding: 30px 32px; width: min(400px, 92vw);
  box-shadow: var(--ent-shadow); color: var(--ent-fg); font-size: 14px; line-height: 1.7; }
#enterprise-violation-overlay .ico { width: 44px; height: 44px; border-radius: 50%; background: var(--ent-bad-soft);
  display: flex; align-items: center; justify-content: center; font-size: 22px; margin: 0 auto 12px; }
#enterprise-violation-overlay h2 { font-size: 17px; margin: 0 0 8px; text-align: center; color: var(--ent-fg); }
#enterprise-violation-overlay .names { margin: 10px 0; padding: 10px 14px; background: var(--ent-bad-tint); border: 1px solid var(--ent-bad-line);
  border-radius: 9px; color: var(--ent-bad-strong); font-size: 13px; text-align: center; word-break: break-all; }
#enterprise-violation-overlay .sub { font-size: 12.5px; color: var(--ent-fg-2); margin-bottom: 16px; }
#enterprise-violation-overlay button { width: 100%; padding: 10px; font-size: 14px; border: none; border-radius: 9px;
  background: var(--ent-accent); color: var(--ent-accent-ink); cursor: pointer; font-family: inherit; }
#enterprise-violation-overlay button:disabled { opacity: .6; cursor: default; }
#enterprise-violation-overlay .hint { margin-top: 10px; text-align: center; font-size: 12px; color: var(--ent-fg-3); }
</style>
<div class="box">
  <div class="ico">🛡️</div>
  <h2>${t2("发现异常插件，已自动卸载", "Suspicious plugin auto-uninstalled")}</h2>
  <div class="names">${names.replace(/</g, "&lt;")}</div>
  <div class="sub">${t2("该插件不在企业允许清单内，已被安全策略移除。重启 DSH 后清理完成方可继续使用。", "This plugin is not on the enterprise allowlist and was removed by security policy. Restart DSH to continue.")}</div>
  <button id="enterprise-violation-restart">${t2("立即重启 DSH", "Restart DSH now")}</button>
  <div class="hint">${t2("企业安全策略：未重启完成前本机不可用（与企业登录同级别管控）", "Enterprise security policy: this device is unavailable until DSH is restarted")}</div>
</div>`;
			document.body.appendChild(overlay);
			overlay.querySelector("#enterprise-violation-restart").addEventListener("click", async (e) => {
				e.target.disabled = true;
				e.target.textContent = t2("正在重启…", "Restarting…");
				try {
					// 宿主桌面重启接口：与设置页同一 webserver（同源同 session，浏览器凭证自动携带）
					const r = await fetch("/api/desktop/restart", { method: "POST", headers: { "content-type": "application/json" }, body: "{}" });
					if (!r.ok) throw new Error(String(r.status));
				} catch { /* 接口不可用时退化为提示手动重启 */ }
				// 重启是异步的：宿主进程退出时窗口随之关闭；若 5s 后还在（接口失败），提示手动重启
				setTimeout(() => {
					const b = overlay.querySelector("#enterprise-violation-restart");
					if (b) { b.disabled = false; b.textContent = t2("重启未响应 · 请手动重启 DSH", "Restart not responding · restart DSH manually"); }
				}, 5000);
			});
		}

		/** 轮询入口：与登录遮罩同一心跳（checkOverlay 顺带检查，复用同一 status 请求不额外开销） */
		async function checkViolationOverlay() {
			if (document.getElementById("enterprise-violation-overlay")) return;
			try {
				const r = await fetch("/api/enterprise/status", { headers: { accept: "application/json" } });
				if (!r.ok) return;
				const s = await r.json();
				const pr = s?.pluginGovernance?.pendingRestart;
				if (pr && pr.names?.length) mountViolationOverlay(pr);
			} catch { /* 网络抖动：下轮再看 */ }
		}
