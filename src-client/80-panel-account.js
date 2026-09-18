		/* ============ 子页 · 账号管理（登录状态/操作） ============ */

		function AccountPanel() {
			const t = useT2();
			const status = useStatus();
			const [msg, setMsg] = react.useState("");
			const [busy, setBusy] = react.useState("");
			const [showRelogin, setShowRelogin] = react.useState(false);
			const [server, setServer] = react.useState("");
			const [user, setUser] = react.useState("");
			const [pass, setPass] = react.useState("");

			// status 首次到位时同步本地可编辑字段（此后不覆盖用户正在编辑的值）
			const seeded = react.useRef(false);
			if (status && !seeded.current) {
				seeded.current = true;
				setServer(status.gateway || status.factoryGateway || "");
			}

			const act = async (key, fn, okMsg) => {
				setBusy(key); setMsg("");
				try {
					const r = await fn();
					if (r && r.ok === false) setMsg("✗ " + (r.error || t("操作失败", "Operation failed")));
					else { setMsg(okMsg || t("✓ 完成", "✓ Done")); await statusStoreRefresh(); }
				} catch (e) { setMsg("✗ " + (e && e.message ? e.message : e)); }
				setBusy("");
			};

			if (!status) return reactJsx.jsx(UI.skeleton, { lines: 4 });

			return reactJsx.jsxs("div", { style: UI.page, children: [
				reactJsx.jsx("h3", { style: UI.h3First(), children: t("登录状态", "Login status") }),
				reactJsx.jsxs("div", { style: UI.card, children: [
					reactJsx.jsxs("div", { style: UI.row, children: [
						reactJsx.jsx("span", { style: UI.label, children: t("账号状态", "Account status") }),
						status.configured
							? UI.dot("var(--ent-ok)", reactJsx.jsx("span", { style: { fontWeight: 600, color: "var(--ent-ok)" }, children: status.user || t("已配置", "Configured") }))
							: UI.dot("var(--ent-bad)", reactJsx.jsx("span", { style: { fontWeight: 600, color: "var(--ent-bad)" }, children: t("未登录", "Not signed in") }))
					] }),
					reactJsx.jsxs("div", { style: UI.row, children: [
						reactJsx.jsx("span", { style: UI.label, children: t("网关地址", "Gateway URL") }),
						reactJsx.jsx("span", { style: UI.mono, children: status.gateway || "—" })
					] }),
					(() => {
						const hb = status.heartbeat || {};
						let node;
						if (!hb.lastAt) node = reactJsx.jsx("span", { style: UI.dim, children: t("尚未发送过心跳", "No heartbeat yet") });
					else if (hb.lastOk) node = UI.dot("var(--ent-ok)", t("在线", "Online") + " · " + new Date(hb.lastAt).toLocaleTimeString(undefined) + " · " + hb.lastLatencyMs + "ms");
					else node = UI.dot("var(--ent-bad)", t("离线", "Offline") + " · " + new Date(hb.lastAt).toLocaleTimeString(undefined) + " · " + (hb.lastError || t("无响应", "No response")));
						return reactJsx.jsxs("div", { style: UI.row, children: [
							reactJsx.jsx("span", { style: UI.label, children: t("在线心跳", "Heartbeat") }),
							node
						] });
					})(),
					(() => {
						const up = status.pluginGovernance && status.pluginGovernance.updatePending;
						const ver = status.pluginVersion || "—";
						const node = up && up.version
							? UI.dot("var(--ent-warn, var(--ent-accent))", ver + " → " + up.version + t("（重启生效）", " (restart to apply)"))
							: reactJsx.jsx("span", { style: UI.mono, children: ver });
						return reactJsx.jsxs("div", { style: UI.row, children: [
							reactJsx.jsx("span", { style: UI.label, children: t("插件版本", "Plugin version") }),
							node
						] });
					})()
				] }),

				// 心跳设置不暴露给用户：心跳开关/间隔由网关统一管理下发（客户端仅显示上方在线状态）

				reactJsx.jsx("h3", { style: UI.h3(), children: t("操作", "Actions") }),
				reactJsx.jsxs("div", { style: { display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center", margin: "8px 0" }, children: [
					reactJsx.jsx("button", { style: Object.assign({}, UI.btn, UI.btnPrimary), disabled: busy !== "", onClick: () => { setShowRelogin(!showRelogin); setMsg(""); }, children: t("重新登录", "Sign in again") }),
					reactJsx.jsx("button", { style: UI.btn, disabled: busy !== "", onClick: () => act("repair", () => apiPost("/api/enterprise/repair"), t("✓ 已按当前凭证重新配置 provider", "✓ Provider reconfigured")), children: busy === "repair" ? t("配置中…", "Configuring…") : t("一键配置 Provider", "One-click provider setup") }),
					reactJsx.jsx("span", { style: { flex: 1 } }),
					reactJsx.jsx("button", { style: UI.btnDangerText, disabled: busy !== "", title: t("清除企业网关配置与凭证，整个 DSH 将锁定直至重新登录", "Clears enterprise gateway config and credentials; DSH locks until you sign in again"), onClick: async () => {
						const ok = await mountConfirmDialog({
							title: t("退出登录", "Sign out"),
							message: t("将清除企业网关配置与凭证，整个 DSH 将锁定直至重新登录。确定退出吗？", "Clear enterprise gateway config and credentials? DSH locks until you sign in again."),
							confirmText: t("退出登录", "Sign out"),
							cancelText: t("取消", "Cancel")
						});
						if (ok) act("logout", () => apiPost("/api/enterprise/logout").then((r) => { if (r.ok) setTimeout(() => location.reload(), 600); return r; }), t("✓ 已退出登录，页面即将锁定", "✓ Signed out; page will lock"));
					}, children: busy === "logout" ? t("退出中…", "Signing out…") : t("退出登录", "Sign out") })
				] }),

				showRelogin && reactJsx.jsxs("div", { style: { border: "1px solid var(--ent-line)", borderRadius: 10, padding: "14px 16px", margin: "8px 0", background: "var(--ent-surface)" }, children: [
					reactJsx.jsx("input", { placeholder: t("网关地址", "Gateway URL"), value: server, onChange: (e) => setServer(e.target.value), style: UI.input }),
					reactJsx.jsx("input", { placeholder: t("账号", "Account"), value: user, onChange: (e) => setUser(e.target.value), style: UI.input }),
					reactJsx.jsx("input", { placeholder: t("密码", "Password"), type: "password", value: pass, onChange: (e) => setPass(e.target.value), style: UI.input }),
					reactJsx.jsx("button", { style: Object.assign({}, UI.btn, UI.btnPrimary, { width: "100%" }), disabled: busy !== "", onClick: () => act("relogin", () => apiPost("/api/enterprise/login", { server: server.trim() || undefined, username: user.trim(), password: pass }).then((r) => { if (r.ok) { setShowRelogin(false); setPass(""); } return r; }), t("✓ 登录成功，配置已更新", "✓ Signed in, config updated")), children: busy === "relogin" ? t("登录中…", "Signing in…") : t("登录并自动配置", "Sign in & auto-configure") })
				] }),

				msg && UI.msg(msg)
			] });
		}
