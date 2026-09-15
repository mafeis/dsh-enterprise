		/* ============ 语言跟随：读 locale 插件的官方同步点 <html lang>（zh-CN / en） ============ */
		/** 当前 UI 语言 hook：locale 插件每次切换都会同步 document lang（zh → zh-CN），MutationObserver 跟随 */
		function useUiLocale() {
			const read = () => {
				try { return (document.documentElement.lang || "zh-CN").toLowerCase().startsWith("zh") ? "zh" : "en"; }
				catch { return "zh"; }
			};
			const [loc, setLoc] = react.useState(read);
			react.useEffect(() => {
				const mo = new MutationObserver(() => setLoc(read()));
				mo.observe(document.documentElement, { attributeFilter: ["lang"] });
				return () => mo.disconnect();
			}, []);
			return loc;
		}
		/** 双语取词：zh 缺失时回退 en（与宿主 locale 的 fallback 链同方向） */
		function useT(dict) {
			const loc = useUiLocale();
			return (key, params) => {
				let s = (dict[key] && (dict[key][loc] ?? dict[key].en)) ?? key;
				if (params) s = s.replace(/\{(\w+)\}/g, (m, n) => n in params ? String(params[n]) : m);
				return s;
			};
		}
