		/* ============ 子页 · 插件管理（企业插件市场） ============ */

		const MARKET_I18N = {
			"market.title": { zh: "企业插件市场", en: "Enterprise Plugin Market" },
			"market.subtitle": { zh: "企业管理员精选的插件，点击即可安装到本机（走企业配置的安装源）。清单外插件安装会被拦截。", en: "Plugins curated by your enterprise admin. Click to install (via the enterprise-configured registry). Plugins outside the allowlist are blocked." },
			"market.violations": { zh: "检测到 {n} 个允许清单之外的插件：{list}。已上报管理台，请联系管理员处理。", en: "Detected {n} plugin(s) outside the allowlist: {list}. Reported to the admin console; contact your administrator." },
			"market.violationsWarn": { zh: "检测到 {n} 个允许清单之外的插件：{list}。仅警告，未做处理。", en: "Detected {n} plugin(s) outside the allowlist: {list}. Warning only — no action taken." },
			"market.none": { zh: "管理员未配置可安装插件清单", en: "No installable plugin list configured by the administrator" },
			"market.other": { zh: "其他插件", en: "Other Plugins" },
			"market.unrestricted": { zh: "未设置白名单限制", en: "No allowlist restriction" },
			"market.pluginName": { zh: "插件包名", en: "Plugin package name" },
			"market.install": { zh: "安装", en: "Install" },
			"market.installing": { zh: "安装中…", en: "Installing…" },
			"market.installed": { zh: "已安装", en: "Installed" },
			"market.uninstall": { zh: "卸载", en: "Uninstall" },
			"market.uninstalling": { zh: "卸载中…", en: "Uninstalling…" },
			"market.uninstallOk": { zh: "已卸载 · 重启 DSH 后完全退出", en: "Uninstalled · restart DSH to fully unload" },
			"market.noDesc": { zh: "（无描述）", en: "(no description)" },
			"market.localInstalled": { zh: "本机已安装", en: "Installed on this machine" },
			"market.noneInstalled": { zh: "无", en: "None" },
			"market.unreadable": { zh: "无法读取安装清单（非 profile 安装形态）", en: "Cannot read installed list (non-profile install)" },
			"market.okUpgrade": { zh: "已热更新生效（dsh-hot-reload 在线，稍候几秒自动替换运行中实例）", en: "Hot-updated (dsh-hot-reload active; the running instance swaps in a few seconds)" },
			"market.okRestart": { zh: "已安装 · 重启 DSH 后生效（首次新增的插件需要重启加载）", en: "Installed · takes effect after restarting DSH (first-time installs need a restart)" },
			"market.controlTitle": { zh: "插件管控", en: "Plugin Governance" },
			"market.controlDesc": { zh: "企业统一管控插件安装：允许清单外的插件安装时直接拦截；安装走企业自建源（如已配置）。", en: "Plugin installs are centrally governed: outside the allowlist they are blocked; installs go through the enterprise registry when configured." },
			"market.removedRestart": { zh: "管理员已移除插件：{list}。本机安装清单已清理，重启 DSH 后完全退出（当前会话内其功能入口可能仍在）。", en: "The administrator removed plugin(s): {list}. The local install manifest has been cleaned; restart DSH to fully unload them (they may remain visible in this session)." }
		};

		function PluginGovernancePanel() {
			const t = useT(MARKET_I18N);
			const loc = useUiLocale();
			const status = useStatus();
			const [market, setMarket] = react.useState(null);
			const [installName, setInstallName] = react.useState("");
			const [installMsg, setInstallMsg] = react.useState("");
			const [installing, setInstalling] = react.useState("");
			const [uninstalling, setUninstalling] = react.useState("");
			react.useEffect(() => {
				let alive = true;
				apiGet("/api/enterprise/market").then((r) => { if (alive) setMarket(r); }).catch(() => { if (alive) setMarket({ ok: false, items: [] }); });
				return () => { alive = false; };
			}, []);
			/** 安装/卸载后重拉市场清单，卡片「已安装」徽章跟着真实状态走 */
			const refreshMarket = () => {
				apiGet("/api/enterprise/market").then((r) => setMarket(r)).catch(() => { });
			};
			if (!status) return reactJsx.jsx(UI.skeleton, { lines: 3 });
			const g = status.pluginGovernance;
			if (!g) return UI.alertBar(t("market.controlDesc"));

			const violations = g.violations || [];
			const installed = g.installedPlugins || [];
			const pendingRestart = g.pendingRestart || null;

			const doInstall = async (name) => {
				setInstalling(name); setInstallMsg("");
				try {
					const res = await apiPost("/api/enterprise/plugin-install", { name });
					if (res.ok) {
						const wasInstalled = market?.items?.find((x) => x.name === name)?.installed;
						const note = wasInstalled && g.installedPlugins?.includes("dsh-hot-reload")
							? t("market.okUpgrade")
							: t("market.okRestart");
						setInstallMsg("✓ " + name + "：" + note);
						statusStoreRefresh();
						refreshMarket();
					} else setInstallMsg("✗ " + name + "：" + (res.error || "install failed"));
				} catch (e) { setInstallMsg("✗ " + name + "：" + (e && e.message ? e.message : e)); }
				setInstalling("");
			};

			const doUninstall = async (name) => {
				setUninstalling(name); setInstallMsg("");
				try {
					const res = await apiPost("/api/enterprise/plugin-remove", { name });
					if (res.ok) {
						setInstallMsg("✓ " + name + "：" + t("market.uninstallOk"));
						statusStoreRefresh();
						refreshMarket();
					} else setInstallMsg("✗ " + name + "：" + (res.error || "uninstall failed"));
				} catch (e) { setInstallMsg("✗ " + name + "：" + (e && e.message ? e.message : e)); }
				setUninstalling("");
			};

			const items = market?.items;
			// 允许清单为空 = 不限装 → 保留手输安装入口
			const unrestricted = Array.isArray(items) && market.ok === true && items.length === 0 && !g.allowedUnknown;

			return reactJsx.jsxs("div", { style: UI.page, children: [
				reactJsx.jsx("h3", { style: UI.h3First(), children: t("market.title") }),
				reactJsx.jsx("p", { style: Object.assign({}, UI.dim, { margin: "0 0 10px" }), children: t("market.subtitle") }),
				violations.length > 0 && g.enforceMode !== "off"
					? UI.alertBar(t(g.enforceMode === "warn" ? "market.violationsWarn" : "market.violations", { n: violations.length, list: violations.join("、") }))
					: null,
				pendingRestart ? UI.alertBar(t("market.removedRestart", { list: (pendingRestart.names || []).join("、") })) : null,
				installMsg ? reactJsx.jsx("div", { style: { marginBottom: 10, fontSize: 13, color: installMsg.startsWith("✗") ? "var(--ent-bad)" : "var(--ent-ok)" }, children: installMsg }) : null,

				!items
					? reactJsx.jsx(UI.skeleton, { lines: 3 })
					: items.length || unrestricted
						? reactJsx.jsx("div", { style: { display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(240px, 1fr))", gap: 10 }, children: [
							...items.map((it) => reactJsx.jsxs("div", { style: Object.assign({}, UI.card, { margin: 0, display: "flex", flexDirection: "column", gap: 6 }), children: [
								reactJsx.jsxs("div", { style: { display: "flex", alignItems: "center", gap: 8 }, children: [
									reactJsx.jsx("b", { style: { fontSize: 13, flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }, title: it.name, children: it.name }),
									it.installed ? UI.okBadge(t("market.installed")) : null
								] }),
								(() => {
									const desc = loc === "zh" ? (it.descriptionZh || it.description || it.descriptionEn) : (it.descriptionEn || it.descriptionZh || it.description);
									return desc
										? reactJsx.jsx("div", { style: Object.assign({}, UI.dim, { flex: 1, display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical", overflow: "hidden" }), children: desc })
										: reactJsx.jsx("div", { style: Object.assign({}, UI.dim, { flex: 1 }), children: t("market.noDesc") });
								})(),
								it.installed
								? reactJsx.jsx("button", { style: Object.assign({}, UI.btn, { width: "100%" }), disabled: uninstalling !== "" || installing !== "", onClick: () => doUninstall(it.name), children: uninstalling === it.name ? t("market.uninstalling") : t("market.uninstall") })
								: reactJsx.jsx("button", { style: Object.assign({}, UI.btn, UI.btnPrimary, { width: "100%" }), disabled: installing !== "" || uninstalling !== "", onClick: () => doInstall(it.name), children: installing === it.name ? t("market.installing") : t("market.install") })
							] }, it.name)),
							unrestricted ? reactJsx.jsxs("div", { style: Object.assign({}, UI.card, { margin: 0 }), children: [
								reactJsx.jsx("div", { style: UI.cardTitle, children: t("market.other") }),
								reactJsx.jsx("div", { style: UI.dim, children: t("market.unrestricted") }),
								reactJsx.jsxs("div", { style: { display: "flex", gap: 8, marginTop: 6 }, children: [
									reactJsx.jsx("input", { value: installName, placeholder: t("market.pluginName"), onChange: (e) => setInstallName(e.target.value), disabled: installing !== "", style: Object.assign({}, UI.input, { marginBottom: 0, flex: 1 }) }),
									reactJsx.jsx("button", { style: Object.assign({}, UI.btn, UI.btnPrimary), disabled: installing !== "" || !installName.trim(), onClick: () => doInstall(installName.trim()), children: installing === installName.trim() ? "…" : t("market.install") })
								] })
							] }) : null
						] })
						: reactJsx.jsx("div", { style: Object.assign({}, UI.card, UI.dim), children: t("market.none") }),

				reactJsx.jsxs("div", { style: UI.card, children: [
					reactJsx.jsx("div", { style: UI.cardTitle, children: t("market.localInstalled") }),
					g.installedUnknown
						? reactJsx.jsx("div", { style: UI.dim, children: t("market.unreadable") })
						: installed.length
							? reactJsx.jsx("div", { children: installed.map((x) => (violations.includes(x) && g.enforceMode !== "off") ? UI.badBadge(x) : UI.okBadge(x)) })
							: reactJsx.jsx("div", { style: UI.dim, children: t("market.noneInstalled") })
				] })
			] });
		}
