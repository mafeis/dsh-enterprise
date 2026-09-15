		/* ============ 子页 · 账号管理（登录状态/心跳/操作） ============ */

		function AccountPanel() {
			const status = useStatus();
			const [msg, setMsg] = react.useState("");
			const [busy, setBusy] = react.useState("");
			const [showRelogin, setShowRelogin] = react.useState(false);
			const [server, setServer] = react.useState("");
			const [user, setUser] = react.useState("");
			const [pass, setPass] = react.useState("");
			const [interval, setIntervalSec] = react.useState(60);

			// status 首次到位时同步本地可编辑字段（此后不覆盖用户正在编辑的值）
			const seeded = react.useRef(false);
			if (status && !seeded.current) {
				seeded.current = true;
				setIntervalSec(status.heartbeatConfig?.intervalSec ?? 60);
				setServer(status.gateway || "");
			}

			const act = async (key, fn, okMsg) => {
				setBusy(key); setMsg("");
				try {
					const r = await fn();
					if (r && r.ok === false) setMsg("✗ " + (r.error || "操作失败"));
					else { setMsg(okMsg || "✓ 完成"); await statusStoreRefresh(); }
				} catch (e) { setMsg("✗ " + (e && e.message ? e.message : e)); }
				setBusy("");
			};

			if (!status) return reactJsx.jsx(UI.skeleton, { lines: 4 });

			return reactJsx.jsxs("div", { style: UI.page, children: [
				reactJsx.jsx("h3", { style: UI.h3First("#2563eb"), children: "登录状态" }),
				reactJsx.jsxs("div", { style: UI.card, children: [
					reactJsx.jsxs("div", { style: UI.row, children: [
						reactJsx.jsx("span", { style: UI.label, children: "账号状态" }),
						status.configured
							? UI.dot("#059669", reactJsx.jsx("span", { style: { fontWeight: 600, color: "#059669" }, children: status.user || "已配置" }))
							: UI.dot("#dc2626", reactJsx.jsx("span", { style: { fontWeight: 600, color: "#dc2626" }, children: "未登录" }))
					] }),
					reactJsx.jsxs("div", { style: UI.row, children: [
						reactJsx.jsx("span", { style: UI.label, children: "网关地址" }),
						reactJsx.jsx("span", { style: UI.mono, children: status.gateway || "—" })
					] }),
					(() => {
						const hb = status.heartbeat || {};
						let node;
						if (!hb.lastAt) node = reactJsx.jsx("span", { style: UI.dim, children: "尚未发送过心跳" });
						else if (hb.lastOk) node = UI.dot("#059669", "在线 · " + new Date(hb.lastAt).toLocaleTimeString("zh-CN") + " · " + hb.lastLatencyMs + "ms");
						else node = UI.dot("#dc2626", "离线 · " + new Date(hb.lastAt).toLocaleTimeString("zh-CN") + " · " + (hb.lastError || "无响应"));
						return reactJsx.jsxs("div", { style: UI.row, children: [
							reactJsx.jsx("span", { style: UI.label, children: "在线心跳" }),
							node
						] });
					})(),
					(() => {
						const pv = (status.heartbeat && status.heartbeat.pluginViolations) || [];
						if (!pv.length) return null;
						return reactJsx.jsxs("div", { style: Object.assign({}, UI.row, { alignItems: "flex-start" }), children: [
							reactJsx.jsx("span", { style: UI.label, children: "插件合规" }),
							UI.dot("#d97706", reactJsx.jsx("span", { style: { color: "#b45309" }, children: pv.length + " 个清单外插件（详见插件管理）" }))
						] });
					})()
				] }),

				reactJsx.jsx("h3", { style: UI.h3("#2563eb"), children: "心跳设置" }),
				reactJsx.jsxs("div", { style: UI.card, children: [
					reactJsx.jsxs("div", { style: Object.assign({}, UI.row, { margin: 0 }), children: [
						reactJsx.jsx("input", { type: "checkbox", checked: !!(status.heartbeatConfig && status.heartbeatConfig.enabled), disabled: busy !== "", onChange: (e) => act("hb", () => apiPost("/api/enterprise/heartbeat-config", { enabled: e.target.checked }), e.target.checked ? "✓ 心跳已开启" : "✓ 心跳已关闭") }),
						reactJsx.jsx("span", { children: "自动心跳" }),
						reactJsx.jsx("span", { style: { flex: 1 } }),
						reactJsx.jsx("input", { type: "number", min: 15, max: 3600, value: interval, disabled: busy !== "", onChange: (e) => setIntervalSec(Number(e.target.value)), style: { width: 64, border: "1px solid #e6eaf1", borderRadius: 6, padding: "3px 8px", fontFamily: "inherit" } }),
						reactJsx.jsx("span", { style: UI.dim, children: "秒" }),
						reactJsx.jsx("button", { style: UI.btn, disabled: busy !== "", onClick: () => act("hbsave", () => apiPost("/api/enterprise/heartbeat-config", { enabled: status.heartbeatConfig?.enabled !== false, intervalSec: interval }), "✓ 间隔已保存"), children: "保存" }),
						reactJsx.jsx("button", { style: UI.btn, disabled: busy !== "", onClick: () => act("hbnow", () => apiPost("/api/enterprise/heartbeat-now").then((r) => { window.__enterpriseCheckOverlay?.(); return r; }), "✓ 心跳已发送"), children: busy === "hbnow" ? "发送中…" : "立即检测" })
					] })
				] }),

				reactJsx.jsx("h3", { style: UI.h3("#2563eb"), children: "操作" }),
				reactJsx.jsxs("div", { style: { display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center", margin: "8px 0" }, children: [
					reactJsx.jsx("button", { style: Object.assign({}, UI.btn, UI.btnPrimary), disabled: busy !== "", onClick: () => { setShowRelogin(!showRelogin); setMsg(""); }, children: "重新登录" }),
					reactJsx.jsx("button", { style: UI.btn, disabled: busy !== "", onClick: () => act("repair", () => apiPost("/api/enterprise/repair"), "✓ 已按当前凭证重新配置 provider"), children: busy === "repair" ? "配置中…" : "一键配置 Provider" }),
					reactJsx.jsx("span", { style: { flex: 1 } }),
					reactJsx.jsx("button", { style: UI.btnDangerText, disabled: busy !== "", title: "清除企业网关配置与凭证，整个 DSH 将锁定直至重新登录", onClick: async () => {
						const ok = await mountConfirmDialog({
							title: "退出登录",
							message: "将清除企业网关配置与凭证，整个 DSH 将锁定直至重新登录。确定退出吗？",
							confirmText: "退出登录",
							cancelText: "取消"
						});
						if (ok) act("logout", () => apiPost("/api/enterprise/logout").then((r) => { if (r.ok) setTimeout(() => location.reload(), 600); return r; }), "✓ 已退出登录，页面即将锁定");
					}, children: busy === "logout" ? "退出中…" : "退出登录" })
				] }),

				showRelogin && reactJsx.jsxs("div", { style: { border: "1px solid #e6eaf1", borderRadius: 10, padding: "14px 16px", margin: "8px 0", background: "#fbfcfe" }, children: [
					reactJsx.jsx("input", { placeholder: "网关地址", value: server, onChange: (e) => setServer(e.target.value), style: UI.input }),
					reactJsx.jsx("input", { placeholder: "账号", value: user, onChange: (e) => setUser(e.target.value), style: UI.input }),
					reactJsx.jsx("input", { placeholder: "密码", type: "password", value: pass, onChange: (e) => setPass(e.target.value), style: UI.input }),
					reactJsx.jsx("button", { style: Object.assign({}, UI.btn, UI.btnPrimary, { width: "100%" }), disabled: busy !== "", onClick: () => act("relogin", () => apiPost("/api/enterprise/login", { server: server.trim() || undefined, username: user.trim(), password: pass }).then((r) => { if (r.ok) { setShowRelogin(false); setPass(""); } return r; }), "✓ 登录成功，配置已更新"), children: busy === "relogin" ? "登录中…" : "登录并自动配置" })
				] }),

				msg && UI.msg(msg)
			] });
		}
