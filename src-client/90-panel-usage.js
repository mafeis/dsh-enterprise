		/* ============ 子页 · 我的消耗 ============ */

		function UsagePanel() {
			const [usage, setUsage] = react.useState(null);
			const [usageDays, setUsageDays] = react.useState(1);
			const [usageMsg, setUsageMsg] = react.useState("");
			const [usageLoading, setUsageLoading] = react.useState(false);
			react.useEffect(() => {
				let alive = true;
				setUsageLoading(true); setUsageMsg("");
				apiGet("/api/enterprise/usage?days=" + usageDays)
					.then((u) => {
						if (!alive) return;
						if (u && u.ok === false) { setUsage(null); setUsageMsg("✗ " + (u.error || "查询失败")); }
						else setUsage(u);
					})
					.catch((e) => { if (alive) { setUsage(null); setUsageMsg("✗ " + (e && e.message ? e.message : e)); } })
					.finally(() => { if (alive) setUsageLoading(false); });
				return () => { alive = false; };
			}, [usageDays]);
			const fmtNum = (n) => (n ?? 0).toLocaleString("zh-CN");
			const rangeLabel = usageDays === 1 ? "当天" : usageDays === 7 ? "近 7 日" : "近 30 天";
			const maxReq = Math.max(1, ...(usage?.byModel || []).map((r) => r.requests || 0));
			return reactJsx.jsxs("div", { style: UI.page, children: [
				reactJsx.jsx("h3", { style: UI.h3First("#2563eb"), children: "我的消耗" }),
				reactJsx.jsxs("div", { style: { display: "flex", gap: 6, alignItems: "center", margin: "0 0 10px" }, children: [
					[1, 7, 30].map((d) => {
						const active = usageDays === d;
						return reactJsx.jsx("button", {
							key: d,
							style: {
								padding: "5px 14px", borderRadius: 99, fontSize: 12.5, fontFamily: "inherit", cursor: "pointer",
								border: "1px solid " + (active ? "#2563eb" : "#e6eaf1"),
								background: active ? "#2563eb" : "#fff",
								color: active ? "#fff" : "#6b7280",
								fontWeight: active ? 600 : 400
							},
							disabled: usageLoading,
							onClick: () => setUsageDays(d),
							children: usageLoading && usageDays === d ? "查询中…" : (d === 1 ? "当天" : d === 7 ? "近 7 日" : "近 30 天")
						});
					}),
					reactJsx.jsx("span", { style: Object.assign({ marginLeft: 6 }, UI.hint), children: "仅统计本人调用 · 按模型汇总不含被拦截请求" })
				] }),
				usageMsg ? UI.alertBar(usageMsg.replace(/^✗\s*/, "")) : null,
				usageLoading && !usage
					? reactJsx.jsx(UI.skeleton, { lines: 3 })
					: usage && usage.summary && (() => {
						const s = usage.summary;
						const total = (s.tokens_in ?? 0) + (s.tokens_out ?? 0);
						return reactJsx.jsxs("div", { children: [
							reactJsx.jsx("div", { style: UI.card, children: reactJsx.jsxs("div", { children: [
								reactJsx.jsxs("div", { style: { display: "flex", gap: 28, flexWrap: "wrap" }, children: [
									reactJsx.jsxs("div", { children: [
										reactJsx.jsx("div", { style: { fontSize: 11.5, color: "#94a3b8" }, children: "调用次数" }),
										reactJsx.jsx("div", { style: Object.assign({ fontSize: 18, fontWeight: 600, color: "#1f2937" }, UI.num), children: fmtNum(s.requests) })
									] }),
									reactJsx.jsxs("div", { children: [
										reactJsx.jsx("div", { style: { fontSize: 11.5, color: "#94a3b8" }, children: "输入 tokens" }),
										reactJsx.jsx("div", { style: Object.assign({ fontSize: 18, fontWeight: 600, color: "#1f2937" }, UI.num), children: fmtNum(s.tokens_in) })
									] }),
									reactJsx.jsxs("div", { children: [
										reactJsx.jsx("div", { style: { fontSize: 11.5, color: "#94a3b8" }, children: "输出 tokens" }),
										reactJsx.jsx("div", { style: Object.assign({ fontSize: 18, fontWeight: 600, color: "#1f2937" }, UI.num), children: fmtNum(s.tokens_out) })
									] }),
									reactJsx.jsxs("div", { children: [
										reactJsx.jsx("div", { style: { fontSize: 11.5, color: "#94a3b8" }, children: rangeLabel + "合计" }),
										reactJsx.jsx("div", { style: Object.assign({ fontSize: 18, fontWeight: 600, color: "#2563eb" }, UI.num), children: fmtNum(total) })
									] })
								] }),
								s.blocked ? reactJsx.jsx("div", { style: Object.assign({ marginTop: 8 }, UI.dim), children:
									"另有 " + fmtNum(s.blocked) + " 次请求被安全策略拦截（未计入以上统计）" }) : null
							] }) }),
							(usage.byModel || []).length > 0 ? reactJsx.jsx("div", { style: Object.assign({}, UI.card, { padding: "6px 14px" }), children: reactJsx.jsxs("table", { style: Object.assign({}, UI.tbl, { margin: 0 }), children: [
								reactJsx.jsx("thead", { children: reactJsx.jsxs("tr", { children: [
									reactJsx.jsx("th", { style: UI.cellHead, children: "模型" }),
									reactJsx.jsx("th", { style: UI.cellHead, children: "占比" }),
									reactJsx.jsx("th", { style: UI.cellHead, children: "调用" }),
									reactJsx.jsx("th", { style: UI.cellHead, children: "输入 tok" }),
									reactJsx.jsx("th", { style: UI.cellHead, children: "输出 tok" })
								] }) }),
								reactJsx.jsx("tbody", { children: usage.byModel.map((r) => reactJsx.jsxs("tr", { children: [
									reactJsx.jsx("td", { style: Object.assign({}, UI.cell, { fontWeight: 500 }), children: r.model || "—" }),
									reactJsx.jsx("td", { style: Object.assign({}, UI.cell, { width: "30%" }), children: reactJsx.jsx("div", { style: { height: 6, borderRadius: 99, background: "#eef1f6", overflow: "hidden" }, children: reactJsx.jsx("div", { style: { height: "100%", width: Math.max(2, Math.round((r.requests || 0) / maxReq * 100)) + "%", background: "#2563eb", borderRadius: 99 } }) }) }),
									reactJsx.jsx("td", { style: Object.assign({}, UI.cell, UI.num), children: fmtNum(r.requests) }),
									reactJsx.jsx("td", { style: Object.assign({}, UI.cell, UI.num), children: fmtNum(r.tokens_in) }),
									reactJsx.jsx("td", { style: Object.assign({}, UI.cell, UI.num), children: fmtNum(r.tokens_out) })
								] }, r.model)) })
							] }) }) : null
						] })
					})()
			] });
		}
