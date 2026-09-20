		/* ============ 设置页 · 企业管理（一级菜单 + 二级 tab） ============ */

		const ENT_TAB_KEY = "enterprise-admin-tab";

		function EnterpriseAdminPanel() {
			// tab 状态提升 + 会话内持久：重开设置回到上次位置
			const [tab, setTab] = react.useState(() => {
				try { const v = sessionStorage.getItem(ENT_TAB_KEY); if (v) return v; } catch { /* 隐私模式等 */ }
				return "account";
			});
			const selectTab = (id) => {
				setTab(id);
				try { sessionStorage.setItem(ENT_TAB_KEY, id); } catch { /* 忽略 */ }
			};
			const status = useStatus();
			const t = useT2();
			const tabs = [
				{ id: "account", label: t("账号管理", "Account"), comp: AccountPanel },
				{ id: "models", label: t("企业模型", "Models"), comp: ModelsPanel },
				{ id: "usage", label: t("用量与额度", "Usage"), comp: UsagePanel },
				{ id: "plugins", label: t("插件管理", "Plugins"), comp: PluginGovernancePanel, alert: !!(status?.pluginGovernance?.violations?.length) },
				{ id: "policy", label: t("规则管理", "Rules"), comp: EntPolicyPanel },
			];
			const Active = tabs.find((tb) => tb.id === tab)?.comp || AccountPanel;
			const tabBtns = tabs.map((tb) => {
				const active = tab === tb.id;
				return reactJsx.jsx("button", {
					key: tb.id,
					style: {
						padding: "8px 15px", fontSize: 13, fontFamily: "inherit", cursor: "pointer",
						border: "none", background: "transparent", marginBottom: -1,
						color: active ? "var(--ent-accent)" : "var(--ent-fg-2)",
						fontWeight: active ? 600 : 400,
						borderBottom: active ? "2px solid var(--ent-accent)" : "2px solid transparent",
						display: "inline-flex", alignItems: "center", gap: 6
					},
					onClick: () => selectTab(tb.id),
					children: [
						tb.label,
						tb.alert ? reactJsx.jsx("span", { style: { width: 7, height: 7, borderRadius: "50%", background: "var(--ent-bad)", display: "inline-block" } }) : null
					]
				});
			});
			return reactJsx.jsxs("div", { children: [
				reactJsx.jsx("div", { style: { display: "flex", gap: 2, borderBottom: "1px solid var(--ent-line)", margin: "0 0 14px", flexWrap: "wrap" }, children: tabBtns }),
				reactJsx.jsx(Active, {})
			] });
		}
