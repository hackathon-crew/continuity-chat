export type ApiErrorCondition =
  | 'unauthorized'
  | 'insufficientBalance'
  | 'tooLarge'
  | 'rateLimited'
  | 'serverBusy'
  | 'network'
  | 'other'

/** 按 HTTP 状态码归类；没有状态码（请求没到达服务端）时按网络问题处理 */
export const classifyStatus = (status: number | undefined): ApiErrorCondition => {
  if (status === 401) {
    return 'unauthorized'
  }
  if (status === 402) {
    return 'insufficientBalance'
  }
  if (status === 413) {
    return 'tooLarge'
  }
  if (status === 429) {
    return 'rateLimited'
  }
  if ((status ?? 0) >= 500) {
    return 'serverBusy'
  }
  return 'other'
}
