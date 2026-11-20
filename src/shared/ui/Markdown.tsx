import ReactMarkdown, { type Options } from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { rehypeStreamReveal } from '../../vendor/everplain/app/agent/rehypeStreamReveal'
import type { StreamReveal } from '../../vendor/everplain/app/agent/useStreamPacer'

export function Markdown({ text, reveal }: { text: string; reveal?: StreamReveal }) {
  const rehype = (
    reveal?.revealedAt.length ? [[rehypeStreamReveal, reveal]] : []
  ) as Options['rehypePlugins']
  return (
    <ReactMarkdown remarkPlugins={[remarkGfm]} rehypePlugins={rehype}>
      {text}
    </ReactMarkdown>
  )
}
