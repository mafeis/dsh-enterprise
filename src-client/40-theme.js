		/* ============ 共享 UI 常量（一处定义，全部面板引用） ============ */
		/* 设计基调：清爽文档风。主色 #2563eb 只用于 tab 选中/主按钮/占比条；
		 * 语义色小面积使用：ok=绿、warn=琥珀、bad=红。字号阶梯 16/13/12.5。 */

		const UI = {
			page: { fontSize: 14, lineHeight: 1.7, maxWidth: 560 },
			h3: (color) => ({ margin: "18px 0 8px", fontSize: 16, fontWeight: 600, color: "#1f2937", borderLeft: "4px solid " + (color || "#2563eb"), paddingLeft: 8 }),
			h3First: (color) => ({ margin: "0 0 8px", fontSize: 16, fontWeight: 600, color: "#1f2937", borderLeft: "4px solid " + (color || "#2563eb"), paddingLeft: 8 }),
			card: { border: "1px solid #e6eaf1", borderRadius: 10, padding: "10px 14px", margin: "6px 0", fontSize: 13, background: "#fbfcfe" },
			cardTitle: { fontWeight: 600, marginBottom: 6, fontSize: 13, color: "#1f2937" },
			btn: { padding: "6px 14px", borderRadius: 8, border: "1px solid #e6eaf1", background: "#fff", cursor: "pointer", fontSize: 13, fontFamily: "inherit" },
			btnPrimary: { background: "#2563eb", color: "#fff", border: "1px solid #2563eb" },
			btnDangerText: { border: "none", background: "transparent", color: "#dc2626", cursor: "pointer", fontSize: 13, fontFamily: "inherit", padding: "6px 10px" },
			input: { width: "100%", border: "1px solid #e6eaf1", borderRadius: 8, padding: "8px 12px", marginBottom: 8, boxSizing: "border-box", fontFamily: "inherit", fontSize: 13, outline: "none" },
			row: { display: "flex", alignItems: "center", gap: 10, margin: "6px 0", fontSize: 13 },
			label: { width: 88, color: "#6b7280", flexShrink: 0 },
			dim: { fontSize: 12.5, color: "#6b7280" },
			hint: { fontSize: 12, color: "#94a3b8" },
			mono: { fontFamily: "Consolas, monospace", fontSize: 12.5, color: "#6b7280" },
			tbl: { width: "100%", borderCollapse: "collapse", fontSize: 12.5, margin: "6px 0" },
			cell: { borderBottom: "1px solid #f0f2f7", padding: "6px 8px", textAlign: "left", whiteSpace: "nowrap" },
			cellHead: { borderBottom: "1px solid #f0f2f7", padding: "6px 8px", textAlign: "left", whiteSpace: "nowrap", background: "#f1f5f9", color: "#475569", fontWeight: 600 },
			num: { fontVariantNumeric: "tabular-nums" },
			/* 徽章：全圆角药丸 + 半透明同色底（设计规范推荐做法） */
			badge(text, bg, color) { return reactJsx.jsx("span", { style: { display: "inline-block", background: bg, color, borderRadius: 99, padding: "1px 9px", fontSize: 11.5, marginRight: 6, whiteSpace: "nowrap" }, children: text }) },
			okBadge(text) { return UI.badge(text, "rgba(5,150,105,.12)", "#059669") },
			badBadge(text) { return UI.badge(text, "rgba(220,38,38,.10)", "#dc2626") },
			infoBadge(text) { return UI.badge(text, "rgba(37,99,235,.10)", "#2563eb") },
			dimBadge(text) { return UI.badge(text, "#f3f4f6", "#6b7280") },
			/* 状态点：8px 圆点 + 文案（在线/离线/警告通用） */
			dot(color, children) {
				return reactJsx.jsxs("span", { style: { display: "inline-flex", alignItems: "center", gap: 6, fontSize: 13 }, children: [
					reactJsx.jsx("span", { style: { width: 8, height: 8, borderRadius: "50%", background: color, display: "inline-block", flexShrink: 0 } }),
					children
				] })
			},
			/* 告警条：左 4px 红条 + 浅红底（仅用于需要用户行动的异常态） */
			alertBar(children) {
				return reactJsx.jsx("div", { style: { border: "1px solid #fecaca", borderLeft: "4px solid #dc2626", background: "#fef2f2", color: "#b91c1c", borderRadius: 10, padding: "10px 14px", margin: "0 0 12px", fontSize: 13, lineHeight: 1.6 }, children })
			},
			/* 加载骨架：三条错峰脉动条 */
			skeleton(lines) {
				return reactJsx.jsx("div", { children: Array.from({ length: lines || 3 }, (_, i) => reactJsx.jsx("div", { style: { height: 12, borderRadius: 6, background: "linear-gradient(90deg,#eef1f6 25%,#f7f9fc 45%,#eef1f6 65%)", backgroundSize: "200% 100%", animation: "enterprise-skel 1.2s ease-in-out infinite", animationDelay: (i * 0.12) + "s", margin: "10px 0", width: (100 - i * 18) + "%" } })) })
			},
			msg(text) { return reactJsx.jsx("div", { style: { marginTop: 10, fontSize: 13, color: text.startsWith("✗") ? "#dc2626" : "#059669" }, children: text }) },
		};

		// 骨架脉动动画（注入一次，全局复用）
		if (typeof document !== "undefined" && !document.getElementById("enterprise-skel-style")) {
			const st = document.createElement("style");
			st.id = "enterprise-skel-style";
			st.textContent = "@keyframes enterprise-skel { 0%{background-position:200% 0} 100%{background-position:-200% 0} }";
			document.head.appendChild(st);
		}
