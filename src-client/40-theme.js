		/* ============ 主题令牌：跟随宿主明暗（body[data-ds-dark-theme]） ============ */
		/* 本插件全部配色只引用 --ent-* 这套语义令牌：宿主有设计令牌（--dsw-alias-*）时直接取，
		 * 没有则用下面的明/暗兜底值。暗色下靠 --dsw-alias-* 自动翻转，兜底值再兜一层，
		 * 避免"深灰字压在深色面板上"这种完全看不清的组合。 */

		const THEME_STYLE_ID = "enterprise-theme-style";
		const THEME_CSS = `
body {
  --ent-fg: var(--dsw-alias-label-primary, #1f2937);
  --ent-fg-2: var(--dsw-alias-label-secondary, #6b7280);
  --ent-fg-3: var(--dsw-alias-label-tertiary, #94a3b8);
  --ent-line: #e6eaf1;
  --ent-line-soft: #f0f2f7;
  --ent-surface: #fbfcfe;
  --ent-surface-2: #f1f5f9;
  --ent-surface-3: #f6f8fb;
  --ent-surface-head-fg: #475569;
  --ent-box: #ffffff;
  --ent-input-bg: #ffffff;
  --ent-accent: #2563eb;
  --ent-accent-ink: #ffffff;
  --ent-accent-soft: rgba(37,99,235,.10);
  --ent-track: #eef1f6;
  --ent-ok: #059669;
  --ent-ok-soft: rgba(5,150,105,.12);
  --ent-ok-line: rgba(5,150,105,.30);
  --ent-ok-tint: #f6fdf9;
  --ent-bad: #c81e1e;
  --ent-bad-strong: #b91c1c;
  --ent-bad-soft: rgba(220,38,38,.10);
  --ent-bad-line: #fecaca;
  --ent-bad-tint: #fef2f2;
  --ent-warn: #9a3412;
  --ent-warn-soft: rgba(251,146,60,.13);
  --ent-warn-line: #fb923c;
  --ent-warn-tint: #fff7ed;
  --ent-notice: #1d4ed8;
  --ent-notice-line: #3b82f6;
  --ent-notice-tint: #eff6ff;
  --ent-badge-dim-bg: #f3f4f6;
  --ent-badge-dim-fg: #6b7280;
  --ent-close: #9ca3af;
  --ent-close-hover: #374151;
  --ent-shadow: 0 24px 70px rgba(0,0,0,.28);
  --ent-shadow-soft: 0 10px 34px rgba(0,0,0,.16);
  --ent-skel: linear-gradient(90deg,#eef1f6 25%,#f7f9fc 45%,#eef1f6 65%);
  --ent-wm-color: #0f172a;
}
body[data-ds-dark-theme] {
  --ent-fg: var(--dsw-alias-label-primary, #e9edf3);
  --ent-fg-2: var(--dsw-alias-label-secondary, #b9bfc7);
  --ent-fg-3: var(--dsw-alias-label-tertiary, #979da6);
  --ent-line: rgba(255,255,255,.14);
  --ent-line-soft: rgba(255,255,255,.09);
  --ent-surface: rgba(255,255,255,.05);
  --ent-surface-2: rgba(255,255,255,.08);
  --ent-surface-3: rgba(255,255,255,.10);
  --ent-surface-head-fg: #cfd3d6;
  --ent-box: #2c2d33;
  --ent-input-bg: rgba(255,255,255,.07);
  --ent-accent: #7fadff;
  --ent-accent-ink: #10131a;
  --ent-accent-soft: rgba(127,173,255,.18);
  --ent-track: rgba(255,255,255,.14);
  --ent-ok: #4ed17e;
  --ent-ok-soft: rgba(78,209,126,.16);
  --ent-ok-line: rgba(78,209,126,.40);
  --ent-ok-tint: rgba(78,209,126,.10);
  --ent-bad: #ff7a7a;
  --ent-bad-strong: #ff9c9c;
  --ent-bad-soft: rgba(255,122,122,.16);
  --ent-bad-line: rgba(255,122,122,.42);
  --ent-bad-tint: rgba(255,122,122,.12);
  --ent-warn: #f5b07a;
  --ent-warn-soft: rgba(251,146,60,.18);
  --ent-warn-line: rgba(251,146,60,.55);
  --ent-warn-tint: rgba(251,146,60,.13);
  --ent-notice: #7ab5ff;
  --ent-notice-line: rgba(96,165,250,.55);
  --ent-notice-tint: rgba(96,165,250,.14);
  --ent-badge-dim-bg: rgba(255,255,255,.11);
  --ent-badge-dim-fg: #c4c9d0;
  --ent-close: #979da6;
  --ent-close-hover: #e9edf3;
  --ent-shadow: 0 24px 70px rgba(0,0,0,.55);
  --ent-shadow-soft: 0 10px 34px rgba(0,0,0,.55);
  --ent-skel: linear-gradient(90deg,rgba(255,255,255,.06) 25%,rgba(255,255,255,.12) 45%,rgba(255,255,255,.06) 65%);
  --ent-wm-color: #e9edf3;
}
/* 遮罩内表单控件：显式给底色/字色，避免深色模式沿用浏览器默认白底黑字 */
#enterprise-overlay input {
  background: var(--ent-input-bg); color: var(--ent-fg); border-color: var(--ent-line); }
#enterprise-overlay input::placeholder { color: var(--ent-fg-3); opacity: 1; }
`;

		function mountThemeStyle() {
			if (typeof document === "undefined" || document.getElementById(THEME_STYLE_ID)) return;
			const st = document.createElement("style");
			st.id = THEME_STYLE_ID;
			st.textContent = THEME_CSS;
			document.head.appendChild(st);
		}
		mountThemeStyle();

		/* ============ 共享 UI 常量（一处定义，全部面板引用） ============ */
		/* 设计基调：清爽文档风。主色只用于 tab 选中/主按钮/占比条；
		 * 语义色小面积使用：ok=绿、warn=琥珀、bad=红。字号阶梯 16/13/12.5。
		 * 颜色一律走 --ent-* 令牌（见上），浅色/深色两套自动切换。 */

		const UI = {
			page: { fontSize: 14, lineHeight: 1.7, maxWidth: 560, color: "var(--ent-fg)" },
			h3: (color) => ({ margin: "18px 0 8px", fontSize: 16, fontWeight: 600, color: "var(--ent-fg)", borderLeft: "4px solid " + (color || "var(--ent-accent)"), paddingLeft: 8 }),
			h3First: (color) => ({ margin: "0 0 8px", fontSize: 16, fontWeight: 600, color: "var(--ent-fg)", borderLeft: "4px solid " + (color || "var(--ent-accent)"), paddingLeft: 8 }),
			card: { border: "1px solid var(--ent-line)", borderRadius: 10, padding: "10px 14px", margin: "6px 0", fontSize: 13, background: "var(--ent-surface)", color: "var(--ent-fg)" },
			cardTitle: { fontWeight: 600, marginBottom: 6, fontSize: 13, color: "var(--ent-fg)" },
			btn: { padding: "6px 14px", borderRadius: 8, border: "1px solid var(--ent-line)", background: "var(--ent-surface-3)", color: "var(--ent-fg)", cursor: "pointer", fontSize: 13, fontFamily: "inherit" },
			btnPrimary: { background: "var(--ent-accent)", color: "var(--ent-accent-ink)", border: "1px solid var(--ent-accent)" },
			btnDangerText: { border: "none", background: "transparent", color: "var(--ent-bad)", cursor: "pointer", fontSize: 13, fontFamily: "inherit", padding: "6px 10px" },
			input: { width: "100%", border: "1px solid var(--ent-line)", borderRadius: 8, padding: "8px 12px", marginBottom: 8, boxSizing: "border-box", fontFamily: "inherit", fontSize: 13, outline: "none", background: "var(--ent-input-bg)", color: "var(--ent-fg)" },
			row: { display: "flex", alignItems: "center", gap: 10, margin: "6px 0", fontSize: 13 },
			label: { width: 88, color: "var(--ent-fg-2)", flexShrink: 0 },
			dim: { fontSize: 12.5, color: "var(--ent-fg-2)" },
			hint: { fontSize: 12, color: "var(--ent-fg-3)" },
			mono: { fontFamily: "Consolas, monospace", fontSize: 12.5, color: "var(--ent-fg-2)" },
			tbl: { width: "100%", borderCollapse: "collapse", fontSize: 12.5, margin: "6px 0", color: "var(--ent-fg)" },
			cell: { borderBottom: "1px solid var(--ent-line-soft)", padding: "6px 8px", textAlign: "left", whiteSpace: "nowrap" },
			cellHead: { borderBottom: "1px solid var(--ent-line-soft)", padding: "6px 8px", textAlign: "left", whiteSpace: "nowrap", background: "var(--ent-surface-2)", color: "var(--ent-surface-head-fg)", fontWeight: 600 },
			num: { fontVariantNumeric: "tabular-nums" },
			/* 徽章：全圆角药丸 + 半透明同色底（设计规范推荐做法） */
			badge(text, bg, color) { return reactJsx.jsx("span", { style: { display: "inline-block", background: bg, color, borderRadius: 99, padding: "1px 9px", fontSize: 11.5, marginRight: 6, whiteSpace: "nowrap" }, children: text }) },
			okBadge(text) { return UI.badge(text, "var(--ent-ok-soft)", "var(--ent-ok)") },
			badBadge(text) { return UI.badge(text, "var(--ent-bad-soft)", "var(--ent-bad)") },
			infoBadge(text) { return UI.badge(text, "var(--ent-accent-soft)", "var(--ent-accent)") },
			dimBadge(text) { return UI.badge(text, "var(--ent-badge-dim-bg)", "var(--ent-badge-dim-fg)") },
			/* 状态点：8px 圆点 + 文案（在线/离线/警告通用） */
			dot(color, children) {
				return reactJsx.jsxs("span", { style: { display: "inline-flex", alignItems: "center", gap: 6, fontSize: 13 }, children: [
					reactJsx.jsx("span", { style: { width: 8, height: 8, borderRadius: "50%", background: color, display: "inline-block", flexShrink: 0 } }),
					children
				] })
			},
			/* 告警条：左 4px 红条 + 浅红底（仅用于需要用户行动的异常态） */
			alertBar(children) {
				return reactJsx.jsx("div", { style: { border: "1px solid var(--ent-bad-line)", borderLeft: "4px solid var(--ent-bad)", background: "var(--ent-bad-tint)", color: "var(--ent-bad-strong)", borderRadius: 10, padding: "10px 14px", margin: "0 0 12px", fontSize: 13, lineHeight: 1.6 }, children })
			},
			/* 加载骨架：三条错峰脉动条 */
			skeleton(lines) {
				return reactJsx.jsx("div", { children: Array.from({ length: lines || 3 }, (_, i) => reactJsx.jsx("div", { style: { height: 12, borderRadius: 6, background: "var(--ent-skel)", backgroundSize: "200% 100%", animation: "enterprise-skel 1.2s ease-in-out infinite", animationDelay: (i * 0.12) + "s", margin: "10px 0", width: (100 - i * 18) + "%" } })) })
			},
			msg(text) { return reactJsx.jsx("div", { style: { marginTop: 10, fontSize: 13, color: text.startsWith("✗") ? "var(--ent-bad)" : "var(--ent-ok)" }, children: text }) },
		};

		// 骨架脉动动画（注入一次，全局复用）
		if (typeof document !== "undefined" && !document.getElementById("enterprise-skel-style")) {
			const st = document.createElement("style");
			st.id = "enterprise-skel-style";
			st.textContent = "@keyframes enterprise-skel { 0%{background-position:200% 0} 100%{background-position:-200% 0} }";
			document.head.appendChild(st);
		}
