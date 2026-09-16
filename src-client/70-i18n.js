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
		/** 非 React 场景读当前语言：'zh' | 'en'（读 locale 插件同步的 <html lang>） */
		function curLocale() {
			try { return (document.documentElement.lang || "zh-CN").toLowerCase().startsWith("zh") ? "zh" : "en"; }
			catch { return "zh"; }
		}
		/** 双语直取（非 React）：t2('中文', 'English')，en 缺失回退 zh */
		function t2(zh, en) { return curLocale() === "en" ? (en ?? zh) : zh; }
		/** 双语直取（React 组件）：const t = useT2(); t('中文', 'English')——语言切换时随宿主 locale 重渲染 */
		function useT2() {
			const loc = useUiLocale();
			return (zh, en) => loc === "en" ? (en ?? zh) : zh;
		}
