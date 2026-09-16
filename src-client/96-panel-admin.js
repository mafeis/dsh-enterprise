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
			const tabs = [
				{ id: "account", label: "账号管理", comp: AccountPanel },
				{ id: "models", label: "企业模型", comp: ModelsPanel },
				{ id: "usage", label: "我的消耗", comp: UsagePanel },
				{ id: "plugins", label: "插件管理", comp: PluginGovernancePanel, alert: !!(status?.pluginGovernance?.violations?.length) },
				{ id: "policy", label: "规则管理", comp: EntPolicyPanel },
			];
			const Active = tabs.find((t) => t.id === tab)?.comp || AccountPanel;
			const tabBtns = tabs.map((t) => {
				const active = tab === t.id;
				return reactJsx.jsx("button", {
					key: t.id,
					style: {
						padding: "8px 15px", fontSize: 13, fontFamily: "inherit", cursor: "pointer",
						border: "none", background: "transparent", marginBottom: -1,
						color: active ? "#2563eb" : "#6b7280",
						fontWeight: active ? 600 : 400,
						borderBottom: active ? "2px solid #2563eb" : "2px solid transparent",
						display: "inline-flex", alignItems: "center", gap: 6
					},
					onClick: () => selectTab(t.id),
					children: [
						t.label,
						t.alert ? reactJsx.jsx("span", { style: { width: 7, height: 7, borderRadius: "50%", background: "#dc2626", display: "inline-block" } }) : null
					]
				});
			});
			return reactJsx.jsxs("div", { children: [
				reactJsx.jsx("div", { style: { display: "flex", gap: 2, borderBottom: "1px solid #e6eaf1", margin: "0 0 14px", flexWrap: "wrap" }, children: tabBtns }),
				reactJsx.jsx(Active, {})
			] });
		}
