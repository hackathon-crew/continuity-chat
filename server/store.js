import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import path from 'node:path'

const initialData = () => ({
  users: [],
  sessions: [],
  subscriptions: [],
  invoices: [],
  profiles: {},
  agentProfiles: {},
  agentMessages: [],
  tools: {},
  tasks: [],
  outbox: [],
})

export class JsonStore {
  constructor(dataDir) {
    this.dataDir = dataDir
    this.file = path.join(dataDir, 'store.json')
    this.data = initialData()
    this.queue = Promise.resolve()
  }

  async init() {
    await mkdir(this.dataDir, { recursive: true })
    try {
      const saved = JSON.parse(await readFile(this.file, 'utf8'))
      this.data = { ...initialData(), ...saved }
    } catch (error) {
      if (error.code !== 'ENOENT') {
        throw error
      }
      await this.persist()
    }
  }

  read(selector = (data) => data) {
    return structuredClone(selector(this.data))
  }

  update(mutator) {
    const task = this.queue.then(async () => {
      const previous = structuredClone(this.data)
      try {
        const result = await mutator(this.data)
        await this.persist()
        return structuredClone(result)
      } catch (error) {
        this.data = previous
        throw error
      }
    })
    this.queue = task.catch(() => {})
    return task
  }

  async persist() {
    const temporary = `${this.file}.${process.pid}.tmp`
    await writeFile(temporary, JSON.stringify(this.data, null, 2), { mode: 0o600 })
    await rename(temporary, this.file)
  }
}

export const defaultProfile = () => ({
  soul: {
    companionName: '小续',
    userName: '',
    relationship: '熟悉彼此的朋友',
    personality: '温柔、真诚、有分寸，不刻意讨好',
    speakingStyle: '自然、简洁，像熟悉的伙伴一样说话',
    boundaries: '不假装真人，不替用户做重要决定',
    customInstructions: '',
  },
  memories: [],
  proactive: {
    enabled: true,
    quietStart: '23:00',
    quietEnd: '08:00',
  },
})

export const defaultAgentProfile = () => ({
  name: 'Personal Agent',
  mission: '理解我的长期目标，主动整理信息并推进需要完成的事情。',
  instructions: '先明确目标，再采取行动。涉及对外发布、消费或敏感操作时先征得确认。',
  autonomy: 'confirm',
})

export const builtInTools = () => [
  {
    id: 'tool-time',
    type: 'current_time',
    name: 'current_time',
    description: '获取指定时区的当前日期和时间',
    enabled: true,
    config: {},
  },
  {
    id: 'tool-calculator',
    type: 'calculator',
    name: 'calculator',
    description: '计算数学表达式，支持四则运算、括号、幂和常用函数',
    enabled: true,
    config: {},
  },
  {
    id: 'tool-read-url',
    type: 'read_url',
    name: 'read_url',
    description: '读取公开网页正文，用于总结或提取信息',
    enabled: false,
    config: {},
  },
]
