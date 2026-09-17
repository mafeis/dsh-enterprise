		/* ============ 子页 · 企业模型 ============ */

		function mmBadges(m, t) {
			const modes = Array.isArray(m.input_modes) && m.input_modes.length ? m.input_modes
				: (Array.isArray(m.input) && m.input.length ? m.input : ["text"]);
			const out = [];
			if (modes.includes("image")) out.push(t("图片", "Image"));
			if (modes.includes("video")) out.push(t("视频", "Video"));
			if (modes.includes("audio")) out.push(t("音频", "Audio"));
			return out;
		}

		function ModelsPanel() {
			const t = useT2();
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
			const fmt = (n) => (n ?? 0).toLocaleString(undefined);
			const models = modelsInfo.models || [];
			const defaultModel = status?.defaultModel;
			return reactJsx.jsxs("div", { style: UI.page, children: [
				reactJsx.jsx("h3", { style: UI.h3First(), children: t("企业模型", "Enterprise models") }),
				!models.length
					? UI.alertBar(t("未获取到模型目录（网关不可达且无本地缓存），请联系企业管理员确认模型上架状态。", "Model catalog unavailable (gateway unreachable and no local cache); contact your enterprise admin"))
					: reactJsx.jsxs("div", { children: [
						reactJsx.jsx("div", { style: Object.assign({}, UI.hint, { marginBottom: 6 }), children:
							t("共 ", "") + models.length + t(" 个模型 · 来源：", " models · source: ") + (modelsInfo.source === "gateway" ? t("网关实时", "gateway live") : t("本地缓存", "local cache")) + t(" · 徽章为该模型支持的输入类型", " · badges show supported input types") }),
						...models.map((m) => {
							const isDefault = m.id === defaultModel;
							const displayName = m.name && m.name !== m.id ? m.name : null;
							const modes = mmBadges(m, t);
							return reactJsx.jsxs("div", { style: Object.assign({}, UI.card, isDefault ? { borderColor: "var(--ent-ok-line)", background: "var(--ent-ok-tint)" } : null), children: [
								reactJsx.jsxs("div", { style: { display: "flex", alignItems: "baseline", gap: 8, flexWrap: "wrap" }, children: [
									reactJsx.jsx("span", { style: { fontWeight: 600, fontSize: 13.5, color: "var(--ent-fg)" }, children: displayName || m.id }),
									displayName ? reactJsx.jsx("span", { style: UI.mono, children: m.id }) : null,
									isDefault ? UI.okBadge(t("默认", "Default")) : null
								] }),
								reactJsx.jsxs("div", { style: Object.assign({ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap", marginTop: 4 }, UI.dim), children: [
									modes.length ? modes.map((b) => UI.infoBadge(b)) : UI.dimBadge(t("纯文本", "Text only")),
									reactJsx.jsx("span", { children: "|" }),
									reactJsx.jsx("span", { children: t("上下文 ", "Context ") + fmt(Math.round((m.context_window ?? m.contextWindow ?? 0) / 1000)) + "K · " + t("最大输出 ", "max output ") + fmt(m.max_tokens ?? m.maxTokens ?? 0) }),
									Array.isArray(m.thinking_levels) && m.thinking_levels.length > 1
										? reactJsx.jsx("span", { children: "| " + t("思考档位 ", "Thinking levels ") + m.thinking_levels.join("/") })
										: null
								] })
							] }, m.id)
						})
					] })
			] });
		}
