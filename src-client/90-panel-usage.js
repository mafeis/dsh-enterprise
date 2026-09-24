		/* ============ 子页 · 我的消耗 ============ */

		function UsagePanel() {
			const t = useT2();
			const [usage, setUsage] = react.useState(null);
			const [usageDays, setUsageDays] = react.useState(1);
			const [usageMsg, setUsageMsg] = react.useState("");
			const [usageLoading, setUsageLoading] = react.useState(false);
			const [quotaDay, setQuotaDay] = react.useState("dailyTokens");
			react.useEffect(() => {
				let alive = true;
				setUsageLoading(true); setUsageMsg("");
				apiGet("/api/enterprise/usage?days=" + usageDays)
					.then((u) => {
						if (!alive) return;
						if (u && u.ok === false) { setUsage(null); setUsageMsg("✗ " + (u.error || t("查询失败", "Query failed"))); }
						else {
							setUsage(u);
							// 额度切换按钮跟随实际配置：默认选第一个有配置的窗口（避免选中无配置窗口出现空面板）
							const lim = u?.quota?.limits ?? {};
							setQuotaDay((cur) => {
								const wins = ["dailyTokens", "weeklyTokens", "monthlyTokens"];
								if (wins.includes(cur) && ((lim[cur] ?? 0) > 0 || (lim[cur.replace("Tokens", "Amount")] ?? 0) > 0)) return cur;
								return wins.find((k) => (lim[k] ?? 0) > 0 || (lim[k.replace("Tokens", "Amount")] ?? 0) > 0) ?? "dailyTokens";
							});
						}
					})
					.catch((e) => { if (alive) { setUsage(null); setUsageMsg("✗ " + (e && e.message ? e.message : e)); } })
					.finally(() => { if (alive) setUsageLoading(false); });
				return () => { alive = false; };
			}, [usageDays]);
			const fmtNum = (n) => {
				const v = n ?? 0;
				if (Math.abs(v) >= 10000000) return (v / 10000).toFixed(1).replace(/\.0$/, "") + " 万";
				return v.toLocaleString(undefined);
			};
			const rangeLabel = usageDays === 1 ? t("当天", "Today") : usageDays === 7 ? t("近 7 日", "Last 7 days") : t("近 30 天", "Last 30 days");
			const maxReq = Math.max(1, ...(usage?.byModel || []).map((r) => r.requests || 0));
		return reactJsx.jsxs("div", { className: "enterprise-panel", style: UI.page, children: [
				reactJsx.jsx("h3", { style: UI.h3First(), children: t("用量与额度", "Usage & quota") }),
				reactJsx.jsxs("div", { style: { display: "flex", gap: 6, alignItems: "center", margin: "0 0 10px" }, children: [
					[1, 7, 30].map((d) => {
						const active = usageDays === d;
						return reactJsx.jsx("button", {
							key: d,
							style: {
								minHeight: 36, padding: "5px 14px", borderRadius: 99, fontSize: 12.5, fontFamily: "inherit", cursor: "pointer",
								border: "1px solid " + (active ? "var(--ent-accent)" : "var(--ent-line)"),
								background: active ? "var(--ent-accent)" : "var(--ent-surface-3)",
								color: active ? "var(--ent-accent-ink)" : "var(--ent-fg-2)",
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
										reactJsx.jsx("div", { style: { fontSize: 11.5, color: "var(--ent-fg-3)" }, children: t("调用次数", "Requests") }),
										reactJsx.jsx("div", { style: Object.assign({ fontSize: 18, fontWeight: 600, color: "var(--ent-fg)" }, UI.num), children: fmtNum(s.requests) })
									] }),
									reactJsx.jsxs("div", { children: [
										reactJsx.jsx("div", { style: { fontSize: 11.5, color: "var(--ent-fg-3)" }, children: t("Token 总消耗", "Total tokens") }),
										reactJsx.jsx("div", { style: Object.assign({ fontSize: 18, fontWeight: 600, color: "var(--ent-fg)" }, UI.num), children: fmtNum(total) })
									] }),
									reactJsx.jsxs("div", { children: [
										reactJsx.jsx("div", { style: { fontSize: 11.5, color: "var(--ent-fg-3)" }, children: t("拦截请求", "Blocked requests") }),
										reactJsx.jsx("div", { style: Object.assign({ fontSize: 18, fontWeight: 600, color: "var(--ent-fg)" }, UI.num), children: fmtNum(s.blocked ?? 0) })
									] })
								] }),
								s.blocked ? reactJsx.jsx("div", { style: Object.assign({ marginTop: 8 }, UI.dim), children:
									t("另有 ", "") + fmtNum(s.blocked) + t(" 次请求被安全策略拦截（未计入以上统计）", " requests blocked by security policy (excluded above)") }) : null
							] }) }),
							usage.quota ? (() => {
								const q = usage.quota;
								const WINS = [
									{ key: "dailyTokens", tab: t("今日", "Today"), tok: t("今日 Token", "Today tokens"), amt: t("今日金额", "Today amount") },
									{ key: "weeklyTokens", tab: t("本周", "This week"), tok: t("本周 Token", "This week tokens"), amt: t("本周金额", "This week amount") },
									{ key: "monthlyTokens", tab: t("本月", "This month"), tok: t("本月 Token", "This month tokens"), amt: t("本月金额", "This month amount") },
								].filter((w) => (q.limits?.[w.key] ?? 0) > 0 || (q.limits?.[w.key.replace("Tokens", "Amount")] ?? 0) > 0);
								if (!WINS.length) return null;
								const barColor = (pct) => pct >= 100 ? "var(--ent-bad)" : pct >= 85 ? "var(--ent-warn)" : "var(--ent-accent)";
								const fmtM = (v) => { const x = (v ?? 0) / 1e6; return (x >= 100 ? x.toFixed(0) : parseFloat(x.toFixed(2)).toString()) + "M" };
								const fmtY = (v) => "¥" + (Math.round((v ?? 0) * 100) / 100);
								const cur = WINS.find((w) => w.key === quotaDay) ?? WINS[0];
								const kTok = cur.key, kAmt = cur.key.replace("Tokens", "Amount");
								const hasTok = (q.limits?.[kTok] ?? 0) > 0, hasAmt = (q.limits?.[kAmt] ?? 0) > 0;
								const row = (label, used, limit, fmt) => {
									const pct = Math.min(100, Math.round(used / limit * 100));
									return reactJsx.jsxs("div", { style: { display: "flex", alignItems: "center", gap: 10, margin: "5px 0" }, children: [
										reactJsx.jsx("span", { style: { width: 84, flexShrink: 0, fontSize: 12, color: "var(--ent-fg-2)" }, children: label }),
										reactJsx.jsx("div", { style: { flex: 1, height: 6, borderRadius: 99, background: "var(--ent-track)", overflow: "hidden" }, children:
											reactJsx.jsx("div", { style: { height: "100%", width: Math.max(2, pct) + "%", background: barColor(pct), borderRadius: 99, transition: "width .25s" } }) }),
										reactJsx.jsxs("span", { style: { fontSize: 12, color: "var(--ent-fg-2)", whiteSpace: "nowrap", fontVariantNumeric: "tabular-nums" }, children: [fmt(used), " / ", fmt(limit)] })
									] }, label);
								};
								return reactJsx.jsxs("div", { className: "ent-usage-detail", style: UI.card, children: [
									reactJsx.jsxs("div", { style: { display: "flex", alignItems: "center", gap: 8, marginBottom: 6 }, children: [
										reactJsx.jsx("span", { style: UI.cardTitle, children: t("额度", "Quota") }),
										reactJsx.jsx("span", { style: { fontSize: 11.5, borderRadius: 99, padding: "2px 10px", color: "var(--ent-fg-2)", background: "var(--ent-badge-dim-bg)" }, children: q.group })
									] }),
									WINS.length > 1 ? reactJsx.jsx("div", { style: { display: "flex", gap: 6, margin: "2px 0 8px" }, children:
										WINS.map((w) => {
											const active = cur.key === w.key;
											return reactJsx.jsx("button", {
												style: {
													minHeight: 36, padding: "4px 12px", borderRadius: 99, fontSize: 12, fontFamily: "inherit", cursor: "pointer",
													border: "1px solid " + (active ? "var(--ent-accent)" : "var(--ent-line)"),
													background: active ? "var(--ent-accent)" : "var(--ent-surface-3)",
													color: active ? "var(--ent-accent-ink)" : "var(--ent-fg-2)",
													fontWeight: active ? 600 : 400
												},
												onClick: () => setQuotaDay(w.key),
												children: w.tab
											}, w.key);
										})
									}) : null,
									hasTok ? row(cur.tok, q.used?.[kTok] ?? 0, q.limits[kTok], fmtM) : null,
									hasAmt ? row(cur.amt, q.used?.[kAmt] ?? 0, q.limits[kAmt], fmtY) : null,
									reactJsx.jsx("div", { style: Object.assign({ marginTop: 4 }, UI.hint), children: t("额度按分组每人独立计算，任一超限返回 429", "Quota is per user within the group; 429 when any limit is exceeded") }),
									reactJsx.jsx("div", { style: { height: 1, background: "var(--ent-line)", margin: "12px 0" } }),
									reactJsx.jsxs("div", { style: UI.cardTitle, children: [t("模型明细", "Model details")] }),
									(usage.byModel || []).length > 0 ? reactJsx.jsxs("table", { className: "ent-tbl-card", style: Object.assign({}, UI.tbl, { margin: 0 }), children: [
										reactJsx.jsx("thead", { children: reactJsx.jsxs("tr", { children: [
											reactJsx.jsx("th", { style: UI.cellHead, children: t("模型", "Model") }),
											reactJsx.jsx("th", { style: UI.cellHead, children: t("占比", "Share") }),
											reactJsx.jsx("th", { style: UI.cellHead, children: t("调用", "Calls") }),
											reactJsx.jsx("th", { style: UI.cellHead, children: t("Token 总消耗", "Total tokens") })
										] }) }),
										reactJsx.jsx("tbody", { children: usage.byModel.map((r) => {
											const modelTokens = (r.tokens_in ?? 0) + (r.tokens_out ?? 0);
											return reactJsx.jsxs("tr", { children: [
												reactJsx.jsx("td", { "data-label": t("模型", "Model"), style: Object.assign({}, UI.cell, { fontWeight: 500 }), children: r.model || "—" }),
												reactJsx.jsx("td", { "data-label": t("占比", "Share"), style: Object.assign({}, UI.cell, { width: "30%" }), children: reactJsx.jsx("div", { style: { height: 6, borderRadius: 99, background: "var(--ent-track)", overflow: "hidden" }, children: reactJsx.jsx("div", { style: { height: "100%", width: Math.max(2, Math.round((r.requests || 0) / maxReq * 100)) + "%", background: "var(--ent-accent)", borderRadius: 99 } }) }) }),
												reactJsx.jsx("td", { "data-label": t("调用", "Calls"), style: Object.assign({}, UI.cell, UI.num), children: fmtNum(r.requests) }),
												reactJsx.jsx("td", { "data-label": t("Token 总消耗", "Total tokens"), style: Object.assign({}, UI.cell, UI.num), children: fmtNum(modelTokens) })
											] }, r.model);
										}) })
									] }) : null
								] });
							})() : null,
						] })
					})()
			] });
		}
