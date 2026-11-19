// 全部是 mock 数据。真实来源见 docs/plan：模型列表来自 UniGate /v1/models，余额与用量来自 UniGate 用户接口。
import type { ConversationToolStep } from '../everplain/app/conversation-view/types'

export type ModelProvider = 'deepseek' | 'openai' | 'zhipu'
export type Model = { id: string; name: string; provider: ModelProvider; note: string }

export const models: Model[] = [
  { id: 'deepseek-flash', name: 'DeepSeek Flash', provider: 'deepseek', note: '日常聊天，回得快' },
  { id: 'deepseek-pro', name: 'DeepSeek Pro', provider: 'deepseek', note: '长文和推理' },
  { id: 'glm-4.6', name: 'GLM-4.6', provider: 'zhipu', note: '中文写作' },
  { id: 'gpt-5.6-sol', name: 'GPT-5.6 Sol', provider: 'openai', note: '复杂任务' },
]

export type ChatTask = { title: string; status: 'running' | 'done' }
export type Turn = {
  id: string
  question: string
  answer: string
  steps?: ConversationToolStep[]
  task?: ChatTask
  streaming?: boolean
  statusText?: string
}

export type Conversation = {
  id: string
  title: string
  group: 'pinned' | 'today' | 'yesterday' | 'earlier'
  model: string
  imported?: { messages: number; last: string }
  turns: Turn[]
}

export const agent = { name: '团子', persona: '说话短，先接住情绪再给建议；记得我的考试、面试和组会时间；不替我做决定。' }

export const user = { name: '林夏', account: 'linxia@unigate', balance: 36.2, monthSpend: 18.74 }

export const conversations: Conversation[] = [
  {
    id: 'rain-store',
    title: '雨夜便利店（续写第七章）',
    group: 'pinned',
    model: 'deepseek-pro',
    imported: { messages: 214, last: '11 月 15 日' },
    turns: [
      {
        id: 'r1',
        question: '第六章最后，她在收银台下面找到那张写着地址的收据。接着写第七章，还是她的视角，节奏慢一点。',
        answer: '## 第七章　收据\n\n雨没有停的意思。周遥把收据摊在台面上，用指甲把卷起的一角压平，墨迹已经洇开了一半，只剩「青石巷 17 号」几个字还算清楚。\n\n她想起那个总在凌晨两点来买关东煮的男人。他从不挑萝卜，只要两串昆布，付钱时会把零钱一枚一枚摆好，像在完成某种仪式。\n\n门口的风铃响了一下，又安静下来。没有人进来。周遥抬头看了眼监控屏，画面里只有被雨打湿的玻璃，和玻璃上她自己模糊的倒影。',
      },
      {
        id: 'r2',
        question: '很好。男人的名字先别出现，让读者和她一样猜。',
        answer: '明白，名字留到第九章他自己说出口。这一章里我只用「那个人」和他的习惯来指代他：两串昆布、摆好的零钱、总是湿着的左肩。读者会先记住这些细节，等名字出现时自然对上。',
      },
    ],
  },
  {
    id: 'weekly',
    title: '帮我改一下周报',
    group: 'today',
    model: 'deepseek-flash',
    turns: [
      {
        id: 'w1',
        question: '这是我这周的周报，帮我改得清楚一点，领导只看前三行。\n\n这周主要在弄用户访谈，做了 6 个，然后整理了一下需求，另外配合设计改了两版原型。',
        answer: '前三行可以这样写：\n\n1. **完成 6 场用户访谈**，归纳出 3 个高频需求，按出现次数排了优先级。\n2. **原型迭代两版**，第二版已和设计确认，下周进入评审。\n3. **下周计划**：把前两个需求写成需求文档，周三前发出。\n\n原文里的「整理了一下」「配合」读起来像在打杂，换成结果和数字，领导扫一眼就知道你这周推进到了哪。',
      },
      {
        id: 'w2',
        question: '再帮我把它做成 5 页 PPT，周五组会用。',
        answer: '交给团子去做了，它会按「本周结果、访谈发现、原型变化、风险、下周计划」排成 5 页，做好放到它那边。',
        task: { title: '周报做成 5 页 PPT', status: 'running' },
      },
    ],
  },
  {
    id: 'cat',
    title: '猫最近不爱吃饭怎么办',
    group: 'today',
    model: 'deepseek-flash',
    turns: [
      {
        id: 'c1',
        question: '我家猫这三天吃得很少，精神还行，会不会有问题？',
        answer: '精神还行是好信号，但连续三天食量明显下降，建议这两天内带去医院看一下，尤其要留意下面几件事：\n\n- **有没有呕吐、腹泻或排尿变少**，任何一项出现都别再等。\n- **换过粮或者家里有变化**，比如搬家、新添了家具，猫会因为应激暂时吃得少。\n- **嘴巴有没有异味、流口水**，口腔问题也会让它不愿意吃。\n\n在去医院之前，可以把粮稍微加热一下，香味更浓，有些猫会愿意多吃几口。',
        steps: [
          { id: 's1', label: '联网搜索：猫 食欲下降 三天 精神正常', status: 'completed', resultItems: [{ id: 'a', title: '猫咪食欲不振的常见原因', excerpt: '应激、口腔疾病、消化道问题最常见。' }, { id: 'b', title: '什么时候必须带猫就医', excerpt: '超过 48 小时几乎不进食需要就医。' }] },
        ],
      },
    ],
  },
  {
    id: 'roommate',
    title: '和室友的矛盾，想听听建议',
    group: 'yesterday',
    model: 'glm-4.6',
    turns: [
      {
        id: 'm1',
        question: '室友每天很晚打游戏还开外放，我说过一次，她嘴上答应但没改。',
        answer: '说过一次没改，挺让人憋屈的，尤其是第二天还要早起。\n\n下一次可以说得更具体一点，把时间和办法一起给出来，比如「十一点以后能不能戴耳机？我第二天八点有课」。对方答应的是一件明确的事，比答应「小声点」更容易做到。\n\n如果再说还是不行，可以一起去找宿管调整作息约定，这时候你手里也有「我提过两次」的事实。',
      },
    ],
  },
  {
    id: 'shen-yan',
    title: '沈砚（角色扮演）',
    group: 'earlier',
    model: 'deepseek-pro',
    imported: { messages: 1286, last: '11 月 12 日' },
    turns: [
      {
        id: 'y1',
        question: '（推开书房的门）先生还没睡？',
        answer: '（他没抬头，笔尖在纸上停了一瞬）门没关严，灯就漏出去了。你倒是会挑时候——进来吧，把门带上，夜里风大。\n\n（他把一盏茶往桌边推了推）凉了，将就喝。',
      },
    ],
  },
  { id: 'essay', title: '考研英语作文批改', group: 'earlier', model: 'deepseek-flash', imported: { messages: 48, last: '11 月 3 日' }, turns: [{ id: 'e1', question: '帮我看看这篇小作文的格式。', answer: '格式整体没问题。称呼后面用逗号，落款写 Li Ming，不写真名，这两处改掉就好。' }] },
  { id: 'python', title: 'Python 爬虫返回 403', group: 'earlier', model: 'gpt-5.6-sol', turns: [{ id: 'p1', question: 'requests 请求一直 403。', answer: '多半是请求头里缺少 `User-Agent`，服务器把它识别成了脚本。先补上浏览器的 UA 再试；如果还是 403，看看是不是需要先访问首页拿到 Cookie。' }] },
]

export const importCandidates = [
  { id: 'i1', title: '雨夜便利店', messages: 214, last: '11 月 15 日' },
  { id: 'i2', title: '沈砚', messages: 1286, last: '11 月 12 日' },
  { id: 'i3', title: '考研英语作文批改', messages: 48, last: '11 月 3 日' },
  { id: 'i4', title: '毕业论文开题思路', messages: 96, last: '10 月 28 日' },
  { id: 'i5', title: '每天睡前聊一会儿', messages: 3402, last: '10 月 27 日' },
  { id: 'i6', title: '日语 N2 单词抽背', messages: 377, last: '10 月 19 日' },
]

export type AgentItem =
  | { kind: 'time'; id: string; label: string }
  | { kind: 'agent'; id: string; text: string; streaming?: boolean }
  | { kind: 'user'; id: string; text: string; live?: boolean }
  | { kind: 'file'; id: string; name: string; meta: string }
  | { kind: 'activity'; id: string; steps: ConversationToolStep[] }
  | { kind: 'reminder'; id: string; title: string; rule: string }

export const agentThread: AgentItem[] = [
  { kind: 'time', id: 't1', label: '昨天 上午 9:02' },
  { kind: 'agent', id: 'a1', text: '早。你说今天十点面试，上周改好的自我介绍放在下面了，路上可以再看一眼。' },
  { kind: 'file', id: 'f1', name: '自我介绍_第三版.docx', meta: 'Word 文档 · 2 页' },
  { kind: 'time', id: 't2', label: '昨天 下午 2:26' },
  { kind: 'agent', id: 'a2', text: '面试结束了吧？怎么样。' },
  { kind: 'user', id: 'u1', text: '还行，问了好多项目细节，有两个没答好' },
  { kind: 'agent', id: 'a3', text: '哪两个？我们把它写成一份复盘，下次就不会卡在同一个地方。' },
  { kind: 'user', id: 'u2', text: '用户量怎么来的，还有为什么不用现成方案。帮我做个复盘 PPT 吧，周五组会要讲' },
  { kind: 'activity', id: 'ac1', steps: [
    { id: 'st1', label: '读取：自我介绍_第三版.docx', status: 'completed' },
    { id: 'st2', label: '联网搜索：产品面试 追问 用户量来源 怎么回答', status: 'completed', resultItems: [{ id: 'r1', title: '产品经理面试里的数据追问', excerpt: '先说口径，再说渠道，最后说留存。' }] },
    { id: 'st3', label: '生成演示文稿：8 页', status: 'completed' },
  ] },
  { kind: 'agent', id: 'a4', text: '做好了，一共 8 页，每个问题按「当时怎么答、哪里不够、下次怎么答」排。' },
  { kind: 'file', id: 'f2', name: '面试复盘_8页.pptx', meta: '演示文稿 · 8 页' },
  { kind: 'time', id: 't3', label: '今天 上午 8:30' },
  { kind: 'agent', id: 'a5', text: '提醒一下，组会是明天下午三点。PPT 我又顺了一遍，第 5 页的用户数和你简历上的对不上，已经改成 **1.2 万**，你确认一下。' },
  { kind: 'user', id: 'u3', text: '对的是 1.2 万。另外提醒我下周三 25 号补测，每天都说一下，特别是周三' },
  { kind: 'agent', id: 'a6', text: '设好了。到 24 号每天傍晚提醒一次，25 号早上、中午、下午各一次。测完跟我说「测完了」，当天剩下的就不发了。' },
  { kind: 'reminder', id: 'rm1', title: '补测提醒', rule: '每天 18:00，25 日当天提醒三次' },
]

export type AgentJob = { id: string; title: string; detail: string; state: 'running' | 'scheduled' | 'done' }
export const agentJobs: AgentJob[] = [
  { id: 'j1', title: '周报做成 5 页 PPT', detail: '来自「帮我改一下周报」· 已完成 3 页', state: 'running' },
  { id: 'j2', title: '补测提醒', detail: '每天 18:00 · 截至 11 月 25 日', state: 'scheduled' },
  { id: 'j3', title: '每周日晚复盘', detail: '每周日 21:00 · 发一份本周回顾', state: 'scheduled' },
  { id: 'j4', title: '面试复盘 PPT', detail: '昨天 下午 2:41 · 8 页', state: 'done' },
]

export type Memory = { id: string; text: string; from: string }
export const memories: Memory[] = [
  { id: 'm1', text: '在读研一，方向是人机交互，导师姓周', from: '11 月 2 日 · 聊天中提到' },
  { id: 'm2', text: '每周五下午三点组会', from: '11 月 8 日 · 聊天中提到' },
  { id: 'm3', text: '养了一只叫豆包的橘猫，三岁', from: '从 DeepSeek 记录导入' },
  { id: 'm4', text: '不喜欢被说「加油」，更想听具体怎么做', from: '11 月 14 日 · 你让我记住的' },
]

export type Tool = { id: string; name: string; detail: string; on: boolean; builtIn?: boolean }
export const tools: Tool[] = [
  { id: 'search', name: '联网搜索', detail: '查最新的信息，回答里附上来源', on: true, builtIn: true },
  { id: 'read', name: '网页读取', detail: '读取你发来的链接全文', on: true, builtIn: true },
  { id: 'ppt', name: '生成演示文稿', detail: '按大纲生成可编辑的 .pptx', on: true },
  { id: 'docs', name: '文档与表格', detail: '读写 Word、Excel 和 PDF', on: true },
  { id: 'schedule', name: '定时与提醒', detail: '按时间主动给你发消息', on: true, builtIn: true },
  { id: 'image', name: '图片生成', detail: '按描述生成插图和封面', on: false },
]

export const usage = [
  { day: '11 月 20 日', model: 'DeepSeek Flash', tokens: '18.2 万', cost: '0.62' },
  { day: '11 月 19 日', model: 'DeepSeek Pro', tokens: '41.7 万', cost: '3.18' },
  { day: '11 月 19 日', model: 'GPT-5.6 Sol', tokens: '6.3 万', cost: '2.04' },
  { day: '11 月 18 日', model: 'GLM-4.6', tokens: '22.5 万', cost: '1.35' },
  { day: '11 月 17 日', model: 'DeepSeek Pro', tokens: '58.9 万', cost: '4.47' },
]

export const scriptedChatReply = '可以，先把这一段的情绪放慢。周遥没有马上出门，她把收据折好塞进围裙口袋，又拿出来看了一遍。\n\n这种来回能让读者感觉到她的犹豫：她既想知道那个地址意味着什么，又害怕知道。下一段再让风铃响起来，这次门真的开了。'

export const scriptedAgentReplies = ['收到。', '我看了下你这周的日程，周三上午是空的，补测安排在上午十点前后最稳。要我顺手把周三的组会材料提前到周二晚上提醒你吗？']
