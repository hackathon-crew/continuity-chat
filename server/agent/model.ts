import { createOpenAI } from '@ai-sdk/openai'
import { stepCountIs, streamText } from 'ai'
import { connectTools, modelTools } from './tools.ts'

const maxSteps = 7

function modelMessages(messages) {
  return messages.map((message) => {
    if (!Array.isArray(message.content)) {
      return message
    }
    return {
      ...message,
      content: message.content.map((part) =>
        part.type === 'image_url'
          ? { type: 'image', image: new URL(part.image_url.url) }
          : { type: 'text', text: part.text }
      ),
    }
  })
}

const labels = {
  web_search: '联网搜索',
  read_web: '读取网页',
  create_presentation: '生成演示文稿',
  read_memory: '读取记忆',
  write_memory: '更新记忆',
  set_reminder: '设定提醒',
  update_task: '更新任务',
}

function toolStep(part, status) {
  const label = labels[part.toolName] ?? part.toolName
  const results = Array.isArray(part.output) ? part.output : []
  const detail = part.output?.name ?? part.output?.title
  return {
    id: part.toolCallId,
    label,
    status,
    detail,
    resultItems: results
      .filter((item) => item && typeof item.title === 'string')
      .slice(0, 6)
      .map((item, index) => ({ id: String(index), title: item.title, excerpt: item.excerpt })),
  }
}

export async function runModel({
  store,
  settings,
  user,
  profile,
  memories,
  messages,
  model,
  search,
  task,
  signal,
  onDelta,
  onStep,
}) {
  const effects = { files: [], memories: [], reminders: [], disposition: null }
  const local = modelTools({ settings, profile, memories, effects, search, task })
  const connected = await connectTools(store, user.id, (id) =>
    onStep({ id, label: '连接 MCP 服务', status: 'failed' })
  )
  const provider = createOpenAI({
    apiKey: store.secret(user, 'model_key'),
    baseURL: settings.gatewayUrl,
    fetch: (resource, init) => fetch(resource, { ...init, redirect: 'error' }),
  })
  const now = new Intl.DateTimeFormat('zh-CN', {
    timeZone: profile.timezone,
    dateStyle: 'full',
    timeStyle: 'long',
  }).format()
  const system = task
    ? `你是 ${profile.name}，一个持续陪伴同一位用户的助理。今天是 ${now}，时区 ${profile.timezone}。
任务是「${task.title}」。原始要求：${task.prompt}。推进任务并使用工具产生实际结果。用户需要演示文稿时调用 create_presentation 生成文件。
只有缺必要信息时才追问，使用 update_task 标记等待。适合稍后继续时用它记录时间。把完成结果直接告诉用户。
${profile.persona}`
    : `今天是 ${now}，时区 ${profile.timezone}。接着用户的对话回答。工具可以读取公开信息、制作文件及按用户明确要求保存记忆和提醒。`
  let text = ''
  try {
    const result = streamText({
      model: provider.chat(model),
      system,
      messages: modelMessages(messages),
      tools: { ...local, ...connected.tools },
      stopWhen: stepCountIs(maxSteps),
      maxRetries: 0,
      abortSignal: signal,
    })
    for await (const part of result.fullStream) {
      switch (part.type) {
        case 'text-delta':
          text += part.text
          await onDelta(part.text, text)
          break
        case 'tool-call':
          await onStep(toolStep(part, 'running'))
          break
        case 'tool-result':
          await onStep(toolStep(part, 'completed'))
          break
        case 'tool-error':
        case 'tool-output-denied':
          await onStep(toolStep(part, 'failed'))
          break
        case 'error':
          throw part.error
        default:
          break
      }
    }
    signal.throwIfAborted()
    return { text, effects }
  } finally {
    await connected.close()
  }
}
