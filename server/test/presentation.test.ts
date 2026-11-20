import assert from 'node:assert/strict'
import test from 'node:test'
import { unzipSync, strFromU8 } from 'fflate'

test('Uni produces editable PowerPoint text', async () => {
  const { createPresentation } = await import('../agent/presentation.ts')
  const file = await createPresentation({
    title: '任务验收',
    slides: [{ title: '进展', bullets: ['第一条证据'] }],
  })
  const zip = unzipSync(file.content)
  assert.match(file.name, /\.pptx$/)
  const xml = strFromU8(zip['ppt/slides/slide1.xml'])
  assert.match(xml, /<a:t>进展<\/a:t>/)
  assert.match(xml, /<a:t>第一条证据<\/a:t>/)
})
