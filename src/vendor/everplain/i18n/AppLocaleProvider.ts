// mock 只有中文：保留 Everplain 的 text(zh, en) 接口，组件源码不用改。
export function useAppLocale() {
  return { text: (zh: string, _en?: string) => zh }
}
