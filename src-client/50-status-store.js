		/* ============ 共享状态：/status 单实例轮询（多面板订阅同一次请求） ============ */

		const statusStore = { data: null, subs: new Set(), timer: null };
		async function statusStorePull() {
			try {
				const s = await apiGet("/api/enterprise/status");
				statusStore.data = s;
			} catch { statusStore.data = null; }
			for (const fn of statusStore.subs) { try { fn(statusStore.data); } catch { /* 单订阅者失败不影响其他 */ } }
		}
		/** 订阅共享 /status：全局 30s 一轮只发一次；首帧无数据时立即拉取 */
		function useStatus() {
			const [data, setData] = react.useState(statusStore.data);
			react.useEffect(() => {
				const fn = (d) => setData(d);
				statusStore.subs.add(fn);
				if (!statusStore.timer) {
					void statusStorePull();
					statusStore.timer = setInterval(() => void statusStorePull(), 30000);
				} else if (!statusStore.data) {
					void statusStorePull();
				}
				return () => {
					statusStore.subs.delete(fn);
					if (statusStore.subs.size === 0 && statusStore.timer) { clearInterval(statusStore.timer); statusStore.timer = null; }
				};
			}, []);
			return data;
		}
		/** 操作后立即刷新共享状态 */
		function statusStoreRefresh() { return statusStorePull(); }
