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

		function ApiProtocolControl({ status }) {
			const t = useT2();
			const [busy, setBusy] = react.useState("");
			const [selected, setSelected] = react.useState(null);
			const [msg, setMsg] = react.useState("");
			const saved = status?.apiProtocol === "responses" ? "responses" : "completions";
			const current = selected || saved;

			react.useEffect(() => { setSelected(null); }, [status?.apiProtocol]);

			const switchTo = async (next) => {
				if (busy || next === current) return;
				setBusy(next);
				setMsg("");
				try {
					const r = await apiPost("/api/enterprise/api-protocol", { protocol: next });
					if (!r || r.ok === false) {
						setMsg("✗ " + ((r && r.error) || t("切换失败", "Switch failed")));
					} else {
						setSelected(next);
						await statusStoreRefresh();
						setMsg(t("✓ 已切换，新的会话将使用该协议", "✓ Switched; new sessions will use this protocol"));
					}
				} catch (e) {
					setMsg("✗ " + (e && e.message ? e.message : e));
				} finally {
					setBusy("");
				}
			};

			const item = (id, label) => {
				const active = current === id;
				return reactJsx.jsx("button", {
					type: "button",
					disabled: busy !== "",
					onClick: () => switchTo(id),
					style: {
						flex: 1,
						minHeight: 34,
						padding: "6px 10px",
						borderRadius: 8,
						border: "none",
						background: active ? "var(--ent-surface)" : "transparent",
						color: active ? "var(--ent-accent)" : "var(--ent-fg-2)",
						fontWeight: active ? 600 : 400,
						boxShadow: active ? "0 1px 2px var(--ent-shadow)" : "none",
						cursor: busy ? "default" : "pointer",
						fontFamily: "inherit",
						fontSize: 12.5,
						whiteSpace: "nowrap"
					},
					children: busy === id ? t("切换中…", "Switching…") : label
				});
			};

			return reactJsx.jsxs("div", { style: Object.assign({}, UI.card, { padding: "10px 12px" }), children: [
				reactJsx.jsx("div", { style: { display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, flexWrap: "wrap", marginBottom: 7 }, children: [
					reactJsx.jsx("span", { style: UI.cardTitle, children: t("网关协议", "Gateway protocol") }),
					reactJsx.jsx("span", { style: UI.hint, children: t("只保留一个 Provider", "Single provider") })
				] }),
				reactJsx.jsxs("div", { style: { display: "flex", width: "100%", maxWidth: 360, padding: 2, border: "1px solid var(--ent-line)", borderRadius: 10, background: "var(--ent-surface-3)", boxSizing: "border-box" }, children: [
					item("completions", "Chat Completions"),
					item("responses", "Responses")
				] }),
				reactJsx.jsx("div", { style: Object.assign({}, UI.hint, { marginTop: 7 }), children:
					current === "responses"
						? t("当前走 /v1/responses，适合支持 Responses API 的宿主。", "Using /v1/responses for hosts that support the Responses API.")
						: t("默认走 /v1/chat/completions，兼容性最好。", "Using /v1/chat/completions for best compatibility.") }),
				msg && UI.msg(msg)
			] });
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
				reactJsx.jsx(ApiProtocolControl, { status }),
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
