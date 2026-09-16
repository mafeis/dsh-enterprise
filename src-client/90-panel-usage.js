		/* ============ 子页 · 我的消耗 ============ */

		function UsagePanel() {
			const t = useT2();
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
						if (u && u.ok === false) { setUsage(null); setUsageMsg("✗ " + (u.error || t("查询失败", "Query failed"))); }
						else setUsage(u);
					})
					.catch((e) => { if (alive) { setUsage(null); setUsageMsg("✗ " + (e && e.message ? e.message : e)); } })
					.finally(() => { if (alive) setUsageLoading(false); });
				return () => { alive = false; };
			}, [usageDays]);
			const fmtNum = (n) => (n ?? 0).toLocaleString(undefined);
			const rangeLabel = usageDays === 1 ? t("当天", "Today") : usageDays === 7 ? t("近 7 日", "Last 7 days") : t("近 30 天", "Last 30 days");
			const maxReq = Math.max(1, ...(usage?.byModel || []).map((r) => r.requests || 0));
			return reactJsx.jsxs("div", { style: UI.page, children: [
				reactJsx.jsx("h3", { style: UI.h3First("#2563eb"), children: t("我的消耗", "My usage") }),
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
							children: usageLoading && usageDays === d ? t("查询中…", "Loading…") : (d === 1 ? t("当天", "Today") : d === 7 ? t("近 7 日", "Last 7 days") : t("近 30 天", "Last 30 days"))
						});
					}),
					reactJsx.jsx("span", { style: Object.assign({ marginLeft: 6 }, UI.hint), children: t("仅统计本人调用 · 按模型汇总不含被拦截请求", "Your own calls only; per-model totals exclude blocked requests") })
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
										reactJsx.jsx("div", { style: { fontSize: 11.5, color: "#94a3b8" }, children: t("调用次数", "Requests") }),
										reactJsx.jsx("div", { style: Object.assign({ fontSize: 18, fontWeight: 600, color: "#1f2937" }, UI.num), children: fmtNum(s.requests) })
									] }),
									reactJsx.jsxs("div", { children: [
										reactJsx.jsx("div", { style: { fontSize: 11.5, color: "#94a3b8" }, children: t("输入 tokens", "Input tokens") }),
										reactJsx.jsx("div", { style: Object.assign({ fontSize: 18, fontWeight: 600, color: "#1f2937" }, UI.num), children: fmtNum(s.tokens_in) })
									] }),
									reactJsx.jsxs("div", { children: [
										reactJsx.jsx("div", { style: { fontSize: 11.5, color: "#94a3b8" }, children: t("输出 tokens", "Output tokens") }),
										reactJsx.jsx("div", { style: Object.assign({ fontSize: 18, fontWeight: 600, color: "#1f2937" }, UI.num), children: fmtNum(s.tokens_out) })
									] }),
									reactJsx.jsxs("div", { children: [
										reactJsx.jsx("div", { style: { fontSize: 11.5, color: "#94a3b8" }, children: rangeLabel + t("合计", " total") }),
										reactJsx.jsx("div", { style: Object.assign({ fontSize: 18, fontWeight: 600, color: "#2563eb" }, UI.num), children: fmtNum(total) })
									] })
								] }),
								s.blocked ? reactJsx.jsx("div", { style: Object.assign({ marginTop: 8 }, UI.dim), children:
									t("另有 ", "") + fmtNum(s.blocked) + t(" 次请求被安全策略拦截（未计入以上统计）", " requests blocked by security policy (excluded above)") }) : null
							] }) }),
							(usage.byModel || []).length > 0 ? reactJsx.jsx("div", { style: Object.assign({}, UI.card, { padding: "6px 14px" }), children: reactJsx.jsxs("table", { style: Object.assign({}, UI.tbl, { margin: 0 }), children: [
								reactJsx.jsx("thead", { children: reactJsx.jsxs("tr", { children: [
									reactJsx.jsx("th", { style: UI.cellHead, children: t("模型", "Model") }),
									reactJsx.jsx("th", { style: UI.cellHead, children: t("占比", "Share") }),
									reactJsx.jsx("th", { style: UI.cellHead, children: t("调用", "Calls") }),
									reactJsx.jsx("th", { style: UI.cellHead, children: t("输入 tok", "In tok") }),
									reactJsx.jsx("th", { style: UI.cellHead, children: t("输出 tok", "Out tok") })
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
