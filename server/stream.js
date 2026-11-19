import { HttpError } from './http.js'

export async function* completionDeltas(response) {
  if (!response.ok) {
    const data = await response.json().catch(() => null)
    const message = data?.error?.message ?? 'UniGate 暂时无法生成回复'
    throw new HttpError(response.status, message, 'model_error')
  }
  const decoder = new TextDecoder()
  let pending = ''
  let finished = false
  for await (const chunk of response.body) {
    pending += decoder.decode(chunk, { stream: true })
    for (;;) {
      const end = /\r?\n\r?\n/.exec(pending)
      if (!end) {
        break
      }
      const event = pending.slice(0, end.index)
      pending = pending.slice(end.index + end[0].length)
      const raw = event
        .split(/\r?\n/)
        .filter((line) => line.startsWith('data:'))
        .map((line) => line.slice(5).trimStart())
        .join('\n')
      if (raw === '[DONE]') {
        return
      }
      if (!raw) {
        continue
      }
      const data = JSON.parse(raw)
      if (data.error?.message) {
        throw new HttpError(502, data.error.message, 'model_error')
      }
      const choice = data.choices?.[0]
      const text = choice?.delta?.content
      if (typeof text === 'string') {
        yield text
      }
      finished ||= Boolean(choice?.finish_reason)
    }
  }
  if (!finished) {
    throw new HttpError(502, '模型回复提前结束。可以从这条消息重新生成。', 'model_interrupted')
  }
}
