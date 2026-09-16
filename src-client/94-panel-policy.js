		/* ============ 子页 · 规则管理 ============ */

		function EntPolicyPanel() {
			const t = useT2();
			const [policy, setPolicy] = react.useState(null);
			const [err, setErr] = react.useState("");
			react.useEffect(() => {
				let alive = true;
				const pull = async () => {
					try { const r = await apiGet("/api/enterprise/policy"); if (alive) { if (r.ok) setPolicy(r.policy); else setErr(r.error || t("策略获取失败", "Failed to load policy")); } }
					catch (e) { if (alive) setErr(String(e && e.message ? e.message : e)); }
				};
				void pull();
				const pollT = setInterval(() => void pull(), 60000);
				return () => { alive = false; clearInterval(pollT); };
			}, []);
			if (err) return UI.alertBar(err);
			if (!policy) return reactJsx.jsx(UI.skeleton, { lines: 4 });
			// /policy/current 顶层即策略字段（version/lockModelConfig/... + auditLevel/dlpEnabled）
			const row = (label, value, warn) => reactJsx.jsxs("div", { style: { display: "flex", justifyContent: "space-between", gap: 16, padding: "8px 0", borderBottom: "1px solid #f0f2f7", fontSize: 13 }, children: [
				reactJsx.jsx("span", { style: { color: "#6b7280", flexShrink: 0 }, children: label }),
				reactJsx.jsx("span", { style: { fontWeight: 500, color: warn ? "#b91c1c" : "#1f2937", textAlign: "right" }, children: value })
			] });
			// DLP 规则数由网关 /policy/current 的 dlpRuleCount 下发（明细规则不下发到终端）
			return reactJsx.jsxs("div", { style: UI.page, children: [
				reactJsx.jsx(ClientRulesSection, {}),
				reactJsx.jsx("h3", { style: UI.h3("#2563eb"), children: t("企业管控规则（网关下发）", "Enterprise policies (gateway-deployed)") }),
				reactJsx.jsx("p", { style: Object.assign({}, UI.dim, { margin: "0 0 10px" }), children:
					t("企业管理员在网关管理台下发的安全与管控策略（只读，随心跳自动更新）。", "Security and control policies deployed by the admin in the gateway console (read-only, auto-updated)") }),
				reactJsx.jsx("div", { style: Object.assign({}, UI.card, { padding: "4px 14px" }), children: [
					row(t("策略版本", "Policy version"), policy.version || "—"),
					row(t("模型配置锁定", "Model config lock"), policy.lockModelConfig ? t("已锁定（模型仅能通过企业账号配置）", "Locked (enterprise account only)") : t("未锁定", "Not locked"), !policy.lockModelConfig),
					row(t("会话水印", "Session watermark"), policy.watermark ? t("已启用", "Enabled") : t("未启用", "Disabled"), !policy.watermark),
					row(t("DLP 内容检测", "DLP content inspection"), policy.dlpEnabled
						? t("已启用", "Enabled") + " · " + (Number.isInteger(policy.dlpRuleCount) ? policy.dlpRuleCount + t(" 条规则", " rules") : t("拦截/脱敏生效中", "Block/masking active"))
						: t("未启用", "Disabled"), !policy.dlpEnabled),
					row(t("审计级别", "Audit level"), policy.auditLevel === "full" ? t("全量（含内容）", "Full (incl. content)") : t("仅元数据", "Metadata only")),
					row(t("插件安装清单", "Allowed plugins"), (policy.allowedPlugins || []).length ? t("已配置（", "Configured (") + policy.allowedPlugins.length + t(" 个）", ")") : t("未限制", "Unrestricted")),
					row(t("停用功能", "Disabled features"), (policy.disabledFeatures || []).length ? policy.disabledFeatures.join(t("、", ", ")) : t("无", "None"))
				] })
			] });
		}

		/* 客户端自助规则：用户视角只看「总量统计 + 近期命中 + 高风险命令提醒」，不展示规则明细 */
		function ClientRulesSection() {
			const t = useT2();
			const [rulesInfo, setRulesInfo] = react.useState(null);
			const [checkUrl, setCheckUrl] = react.useState("");
			const [checkMsg, setCheckMsg] = react.useState(null);
			react.useEffect(() => {
				let alive = true;
				apiGet("/api/enterprise/rules").then((r) => { if (alive) setRulesInfo(r); }).catch(() => { if (alive) setRulesInfo({ ok: false, rules: [] }); });
				return () => { alive = false; };
			}, []);
			const doCheck = async () => {
				if (!checkUrl.trim()) return;
				try {
					const r = await apiPost("/api/enterprise/rules/check-url", { url: checkUrl.trim() });
					setCheckMsg(r.allowed ? { ok: true, text: t("✓ 未命中拦截规则，可访问", "✓ Not blocked, access allowed") } : { ok: false, text: t("⛔ 已被企业规则拦截（", "⛔ Blocked by enterprise rules (") + (r.hit?.id || "") + t("）", ")") + (r.message || "") });
				} catch (e) { setCheckMsg({ ok: false, text: "✗ " + (e && e.message ? e.message : e) }); }
			};
			const rules = rulesInfo?.rules || [];
			const runs = rulesInfo?.runs;
			const hits = rulesInfo?.hits || [];
			const refreshRules = async () => { try { const r = await apiGet("/api/enterprise/rules"); setRulesInfo(r); } catch { /* 忽略 */ } };
			// 规则总量按类型聚合（不给明细）
			const byType = {};
			for (const r of rules) byType[r.type] = (byType[r.type] ?? 0) + 1;
			const typeLabel = { "block-url": t("网址拦截", "URL block"), "block-word": t("关键词拦截", "Keyword block"), "block-plugin": t("插件拦截", "Plugin block"), "force-default-model": t("强制默认模型", "Force default model"), "notice": t("公告提示", "Notice") };
			return reactJsx.jsxs("div", { children: [
				reactJsx.jsx("h3", { style: UI.h3First("#2563eb"), children: t("本机执行规则", "Local rules") }),
				reactJsx.jsx("p", { style: Object.assign({}, UI.dim, { margin: "0 0 10px" }), children:
					t("企业管理员统一下发的安全规则，在本机强制执行（规则明细不在终端展示）。", "Security rules deployed by the admin, enforced on this client (details not shown)") }),
				// 总量统计卡：几个数字，一眼看清
				reactJsx.jsx("div", { style: UI.card, children: reactJsx.jsxs("div", { style: { display: "flex", gap: 28, flexWrap: "wrap" }, children: [
					reactJsx.jsxs("div", { children: [
						reactJsx.jsx("div", { style: { fontSize: 11.5, color: "#94a3b8" }, children: t("生效规则", "Active rules") }),
						reactJsx.jsx("div", { style: Object.assign({ fontSize: 18, fontWeight: 600, color: "#1f2937" }, UI.num), children: rules.length + t(" 条", " rules") })
					] }),
					...Object.entries(byType).map(([ty, n]) => reactJsx.jsxs("div", { children: [
						reactJsx.jsx("div", { style: { fontSize: 11.5, color: "#94a3b8" }, children: typeLabel[ty] || ty }),
						reactJsx.jsx("div", { style: Object.assign({ fontSize: 18, fontWeight: 600, color: "#1f2937" }, UI.num), children: n + t(" 条", " rules") })
					] }, ty)),
					reactJsx.jsxs("div", { children: [
						reactJsx.jsx("div", { style: { fontSize: 11.5, color: "#94a3b8" }, children: t("本会话拦截", "Blocked this session") }),
						reactJsx.jsx("div", { style: Object.assign({ fontSize: 18, fontWeight: 600, color: (runs?.blocked ?? 0) > 0 ? "#dc2626" : "#1f2937" }, UI.num), children: (runs?.blocked ?? 0) + t(" 次", " times") })
					] })
				] }) }),
				// 高风险操作提醒（rm -rf / 格式化 / fork炸弹 等）：命中过就置顶红条常驻提示
				(() => {
					const dangerHits = hits.filter((h) => h.risk === "high");
					if (!dangerHits.length) return null;
					return UI.alertBar(
						t("高风险命令提醒：Agent 最近尝试执行 ", "High-risk commands: agent attempted ") + dangerHits.length + t(" 次高危操作（如删除文件、格式化磁盘等），已被安全策略拦截。如非本人操作请联系管理员。", " high-risk operations (file deletion, disk formatting, etc.) — blocked by policy. Contact admin if this wasn't you")
					)
				})(),
				// 近期命中
				reactJsx.jsxs("div", { style: UI.card, children: [
					reactJsx.jsxs("div", { style: { display: "flex", alignItems: "center", justifyContent: "space-between" }, children: [
						reactJsx.jsx("div", { style: UI.cardTitle, children: t("近期命中", "Recent hits") }),
						reactJsx.jsx("button", { style: Object.assign({}, UI.btn, { padding: "3px 10px", fontSize: 12 }), onClick: refreshRules, children: t("刷新", "Refresh") })
					] }),
					!hits.length
						? reactJsx.jsx("div", { style: UI.dim, children: t("暂无命中记录（规则生效但尚未触发过）", "No hits yet (rules active, none triggered)") })
						: reactJsx.jsx("table", { style: Object.assign({}, UI.tbl, { margin: 0 }), children: [
							reactJsx.jsx("thead", { children: reactJsx.jsxs("tr", { children: [
								reactJsx.jsx("th", { style: UI.cellHead, children: t("时间", "Time") }),
								reactJsx.jsx("th", { style: UI.cellHead, children: t("类型", "Type") }),
								reactJsx.jsx("th", { style: UI.cellHead, children: t("详情", "Detail") })
							] }) }),
							reactJsx.jsx("tbody", { children: hits.slice(0, 20).map((h, i) => reactJsx.jsxs("tr", { children: [
								reactJsx.jsx("td", { style: Object.assign({}, UI.cell, { color: "#6b7280" }), children: new Date(h.at).toLocaleTimeString(undefined) }),
								reactJsx.jsx("td", { style: UI.cell, children: h.risk === "high"
									? UI.badBadge(t("高危", "High risk"), "rgba(220,38,38,.14)", "#dc2626")
									: UI.infoBadge(h.kind === "search" ? t("搜索过滤", "Search filter") : h.kind === "word" ? t("关键词", "Keyword") : t("网址", "URL")) }),
								reactJsx.jsx("td", { style: Object.assign({}, UI.cell, { maxWidth: 300, overflow: "hidden", textOverflow: "ellipsis" }), title: h.detail, children: h.detail })
							] }, i)) })
						] })
				] }),
				rules.some((r) => r.type === "block-url") ? reactJsx.jsxs("div", { style: UI.card, children: [
					reactJsx.jsx("div", { style: UI.cardTitle, children: t("试一试：检测某网址是否被拦截", "Check if a URL is blocked") }),
					reactJsx.jsxs("div", { style: { display: "flex", gap: 8 }, children: [
						reactJsx.jsx("input", { value: checkUrl, placeholder: "https://example.com", onChange: (e) => setCheckUrl(e.target.value), style: Object.assign({}, UI.input, { marginBottom: 0, flex: 1 }) }),
						reactJsx.jsx("button", { style: UI.btn, onClick: doCheck, children: t("检测", "Check") })
					] }),
					checkMsg && reactJsx.jsx("div", { style: { marginTop: 8, fontSize: 13, color: checkMsg.ok ? "#059669" : "#dc2626" }, children: checkMsg.text })
				] }) : null
			] });
		}
