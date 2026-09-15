		/* ============ 子页 · 企业模型 ============ */

		function mmBadges(m) {
			const modes = Array.isArray(m.input_modes) && m.input_modes.length ? m.input_modes
				: (Array.isArray(m.input) && m.input.length ? m.input : ["text"]);
			const out = [];
			if (modes.includes("image")) out.push("图片");
			if (modes.includes("video")) out.push("视频");
			if (modes.includes("audio")) out.push("音频");
			return out;
		}

		function ModelsPanel() {
			const status = useStatus();
			const [modelsInfo, setModelsInfo] = react.useState(null);
			react.useEffect(() => {
				let alive = true;
				apiGet("/api/enterprise/models")
					.then((r) => { if (alive) setModelsInfo(r); })
					.catch(() => { if (alive) setModelsInfo({ ok: false, models: [] }); });
				return () => { alive = false; };
			}, []);
			if (!modelsInfo) return reactJsx.jsx(UI.skeleton, { lines: 4 });
			const fmt = (n) => (n ?? 0).toLocaleString("zh-CN");
			const models = modelsInfo.models || [];
			const defaultModel = status?.defaultModel;
			return reactJsx.jsxs("div", { style: UI.page, children: [
				reactJsx.jsx("h3", { style: UI.h3First("#2563eb"), children: "企业模型" }),
				!models.length
					? UI.alertBar("未获取到模型目录（网关不可达且无本地缓存），请联系企业管理员确认模型上架状态。")
					: reactJsx.jsxs("div", { children: [
						reactJsx.jsx("div", { style: Object.assign({}, UI.hint, { marginBottom: 6 }), children:
							"共 " + models.length + " 个模型 · 来源：" + (modelsInfo.source === "gateway" ? "网关实时" : "本地缓存") + " · 徽章为该模型支持的输入类型" }),
						...models.map((m) => {
							const isDefault = m.id === defaultModel;
							const displayName = m.name && m.name !== m.id ? m.name : null;
							const modes = mmBadges(m);
							return reactJsx.jsxs("div", { style: Object.assign({}, UI.card, isDefault ? { borderColor: "#a7f3d0", background: "#f6fdf9" } : null), children: [
								reactJsx.jsxs("div", { style: { display: "flex", alignItems: "baseline", gap: 8, flexWrap: "wrap" }, children: [
									reactJsx.jsx("span", { style: { fontWeight: 600, fontSize: 13.5, color: "#1f2937" }, children: displayName || m.id }),
									displayName ? reactJsx.jsx("span", { style: UI.mono, children: m.id }) : null,
									isDefault ? UI.okBadge("默认") : null
								] }),
								reactJsx.jsxs("div", { style: Object.assign({ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap", marginTop: 4 }, UI.dim), children: [
									modes.length ? modes.map((b) => UI.infoBadge(b)) : UI.dimBadge("纯文本"),
									reactJsx.jsx("span", { children: "|" }),
									reactJsx.jsx("span", { children: "上下文 " + fmt(Math.round((m.context_window ?? m.contextWindow ?? 0) / 1000)) + "K · 最大输出 " + fmt(m.max_tokens ?? m.maxTokens ?? 0) }),
									Array.isArray(m.thinking_levels) && m.thinking_levels.length > 1
										? reactJsx.jsx("span", { children: "| 思考档位 " + m.thinking_levels.join("/") })
										: null
								] })
							] }, m.id)
						})
					] })
			] });
		}
