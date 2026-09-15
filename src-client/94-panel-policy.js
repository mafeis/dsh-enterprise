		/* ============ 子页 · 规则管理 ============ */

		function EntPolicyPanel() {
			const [policy, setPolicy] = react.useState(null);
			const [err, setErr] = react.useState("");
			react.useEffect(() => {
				let alive = true;
				const pull = async () => {
					try { const r = await apiGet("/api/enterprise/policy"); if (alive) { if (r.ok) setPolicy(r.policy); else setErr(r.error || "策略获取失败"); } }
					catch (e) { if (alive) setErr(String(e && e.message ? e.message : e)); }
				};
				void pull();
				const t = setInterval(() => void pull(), 60000);
				return () => { alive = false; clearInterval(t); };
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
				reactJsx.jsx("h3", { style: UI.h3("#2563eb"), children: "企业管控规则（网关下发）" }),
				reactJsx.jsx("p", { style: Object.assign({}, UI.dim, { margin: "0 0 10px" }), children:
					"企业管理员在网关管理台下发的安全与管控策略（只读，随心跳自动更新）。" }),
				reactJsx.jsx("div", { style: Object.assign({}, UI.card, { padding: "4px 14px" }), children: [
					row("策略版本", policy.version || "—"),
					row("模型配置锁定", policy.lockModelConfig ? "已锁定（模型仅能通过企业账号配置）" : "未锁定", !policy.lockModelConfig),
					row("会话水印", policy.watermark ? "已启用" : "未启用", !policy.watermark),
					row("DLP 内容检测", policy.dlpEnabled
						? "已启用 · " + (Number.isInteger(policy.dlpRuleCount) ? policy.dlpRuleCount + " 条规则" : "拦截/脱敏生效中")
						: "未启用", !policy.dlpEnabled),
					row("审计级别", policy.auditLevel === "full" ? "全量（含内容）" : "仅元数据"),
					row("插件安装清单", (policy.allowedPlugins || []).length ? "已配置（" + policy.allowedPlugins.length + " 个）" : "未限制"),
					row("停用功能", (policy.disabledFeatures || []).length ? policy.disabledFeatures.join("、") : "无")
				] })
			] });
		}

		/* 客户端自助规则：用户视角只看「总量统计 + 近期命中 + 高风险命令提醒」，不展示规则明细 */
		function ClientRulesSection() {
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
					setCheckMsg(r.allowed ? { ok: true, text: "✓ 未命中拦截规则，可访问" } : { ok: false, text: "⛔ 已被企业规则拦截（" + (r.hit?.id || "") + "）" + (r.message || "") });
				} catch (e) { setCheckMsg({ ok: false, text: "✗ " + (e && e.message ? e.message : e) }); }
			};
			const rules = rulesInfo?.rules || [];
			const runs = rulesInfo?.runs;
			const hits = rulesInfo?.hits || [];
			const refreshRules = async () => { try { const r = await apiGet("/api/enterprise/rules"); setRulesInfo(r); } catch { /* 忽略 */ } };
			// 规则总量按类型聚合（不给明细）
			const byType = {};
			for (const r of rules) byType[r.type] = (byType[r.type] ?? 0) + 1;
			const typeLabel = { "block-url": "网址拦截", "block-word": "关键词拦截", "block-plugin": "插件拦截", "force-default-model": "强制默认模型", "notice": "公告提示" };
			return reactJsx.jsxs("div", { children: [
				reactJsx.jsx("h3", { style: UI.h3First("#2563eb"), children: "本机执行规则" }),
				reactJsx.jsx("p", { style: Object.assign({}, UI.dim, { margin: "0 0 10px" }), children:
					"企业管理员统一下发的安全规则，在本机强制执行（规则明细不在终端展示）。" }),
				// 总量统计卡：几个数字，一眼看清
				reactJsx.jsx("div", { style: UI.card, children: reactJsx.jsxs("div", { style: { display: "flex", gap: 28, flexWrap: "wrap" }, children: [
					reactJsx.jsxs("div", { children: [
						reactJsx.jsx("div", { style: { fontSize: 11.5, color: "#94a3b8" }, children: "生效规则" }),
						reactJsx.jsx("div", { style: Object.assign({ fontSize: 18, fontWeight: 600, color: "#1f2937" }, UI.num), children: rules.length + " 条" })
					] }),
					...Object.entries(byType).map(([t, n]) => reactJsx.jsxs("div", { children: [
						reactJsx.jsx("div", { style: { fontSize: 11.5, color: "#94a3b8" }, children: typeLabel[t] || t }),
						reactJsx.jsx("div", { style: Object.assign({ fontSize: 18, fontWeight: 600, color: "#1f2937" }, UI.num), children: n + " 条" })
					] }, t)),
					reactJsx.jsxs("div", { children: [
						reactJsx.jsx("div", { style: { fontSize: 11.5, color: "#94a3b8" }, children: "本会话拦截" }),
						reactJsx.jsx("div", { style: Object.assign({ fontSize: 18, fontWeight: 600, color: (runs?.blocked ?? 0) > 0 ? "#dc2626" : "#1f2937" }, UI.num), children: (runs?.blocked ?? 0) + " 次" })
					] })
				] }) }),
				// 高风险操作提醒（rm -rf / 格式化 / fork炸弹 等）：命中过就置顶红条常驻提示
				(() => {
					const dangerHits = hits.filter((h) => h.risk === "high");
					if (!dangerHits.length) return null;
					return UI.alertBar(
						"高风险命令提醒：Agent 最近尝试执行 " + dangerHits.length + " 次高危操作（如删除文件、格式化磁盘等），已被安全策略拦截。如非本人操作请联系管理员。"
					)
				})(),
				// 近期命中
				reactJsx.jsxs("div", { style: UI.card, children: [
					reactJsx.jsxs("div", { style: { display: "flex", alignItems: "center", justifyContent: "space-between" }, children: [
						reactJsx.jsx("div", { style: UI.cardTitle, children: "近期命中" }),
						reactJsx.jsx("button", { style: Object.assign({}, UI.btn, { padding: "3px 10px", fontSize: 12 }), onClick: refreshRules, children: "刷新" })
					] }),
					!hits.length
						? reactJsx.jsx("div", { style: UI.dim, children: "暂无命中记录（规则生效但尚未触发过）" })
						: reactJsx.jsx("table", { style: Object.assign({}, UI.tbl, { margin: 0 }), children: [
							reactJsx.jsx("thead", { children: reactJsx.jsxs("tr", { children: [
								reactJsx.jsx("th", { style: UI.cellHead, children: "时间" }),
								reactJsx.jsx("th", { style: UI.cellHead, children: "类型" }),
								reactJsx.jsx("th", { style: UI.cellHead, children: "详情" })
							] }) }),
							reactJsx.jsx("tbody", { children: hits.slice(0, 20).map((h, i) => reactJsx.jsxs("tr", { children: [
								reactJsx.jsx("td", { style: Object.assign({}, UI.cell, { color: "#6b7280" }), children: new Date(h.at).toLocaleTimeString("zh-CN") }),
								reactJsx.jsx("td", { style: UI.cell, children: h.risk === "high"
									? UI.badBadge("高危", "rgba(220,38,38,.14)", "#dc2626")
									: UI.infoBadge(h.kind === "search" ? "搜索过滤" : h.kind === "word" ? "关键词" : "网址") }),
								reactJsx.jsx("td", { style: Object.assign({}, UI.cell, { maxWidth: 300, overflow: "hidden", textOverflow: "ellipsis" }), title: h.detail, children: h.detail })
							] }, i)) })
						] })
				] }),
				rules.some((r) => r.type === "block-url") ? reactJsx.jsxs("div", { style: UI.card, children: [
					reactJsx.jsx("div", { style: UI.cardTitle, children: "试一试：检测某网址是否被拦截" }),
					reactJsx.jsxs("div", { style: { display: "flex", gap: 8 }, children: [
						reactJsx.jsx("input", { value: checkUrl, placeholder: "https://example.com", onChange: (e) => setCheckUrl(e.target.value), style: Object.assign({}, UI.input, { marginBottom: 0, flex: 1 }) }),
						reactJsx.jsx("button", { style: UI.btn, onClick: doCheck, children: "检测" })
					] }),
					checkMsg && reactJsx.jsx("div", { style: { marginTop: 8, fontSize: 13, color: checkMsg.ok ? "#059669" : "#dc2626" }, children: checkMsg.text })
				] }) : null
			] });
		}
