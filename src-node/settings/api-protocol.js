/** 企业网关 API 协议：同一时间只启用 ent-gateway 一个 provider，由用户在企业模型页切换。 */
export const API_PROTOCOL_COMPLETIONS = 'completions'
export const API_PROTOCOL_RESPONSES = 'responses'
export const DEFAULT_API_PROTOCOL = API_PROTOCOL_COMPLETIONS

/** 把外部输入/历史状态归一化为两个稳定值之一；未知值按默认 Completions 处理。 */
export function normalizeApiProtocol(value) {
  return value === API_PROTOCOL_RESPONSES ? API_PROTOCOL_RESPONSES : API_PROTOCOL_COMPLETIONS
}

/** DSH provider 的 api 字段。 */
export function apiKindForProtocol(protocol) {
  return normalizeApiProtocol(protocol) === API_PROTOCOL_RESPONSES ? 'openai-responses' : 'openai-completions'
}

/** 从 DSH provider.api 反推协议，供老版本状态缺 apiProtocol 时兼容。 */
export function protocolFromApiKind(api) {
  return api === 'openai-responses' ? API_PROTOCOL_RESPONSES : API_PROTOCOL_COMPLETIONS
}
