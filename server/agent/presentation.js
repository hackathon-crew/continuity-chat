import { randomUUID } from 'node:crypto'
import pptxgen from 'pptxgenjs'

const palette = { paper: 'F7F5F0', ink: '212421', accent: '3D5650' }
const fontFace = 'Microsoft YaHei'

export async function createPresentation({ title, slides }) {
  const deck = new pptxgen()
  deck.layout = 'LAYOUT_WIDE'
  deck.title = title
  deck.author = 'Uni'
  deck.lang = 'zh-CN'
  for (const [index, content] of slides.entries()) {
    const slide = deck.addSlide()
    slide.background = { color: palette.paper }
    slide.addText(content.title, {
      x: 0.8,
      y: 0.65,
      w: 11.7,
      h: 1.25,
      margin: 0,
      fit: 'shrink',
      color: palette.ink,
      fontFace,
      fontSize: 32,
      bold: true,
    })
    const paragraphs = content.bullets.map((text) => ({
      text,
      options: { bullet: { indent: 24 }, breakLine: true },
    }))
    slide.addText(paragraphs, {
      x: 0.86,
      y: 2.05,
      w: 11.5,
      h: 4.5,
      fit: 'shrink',
      margin: 0,
      fontFace,
      fontSize: 20,
      color: palette.ink,
      paraSpaceAfter: 18,
      valign: 'top',
    })
    slide.addText(`${index + 1} / ${slides.length}`, {
      x: 10.5,
      y: 6.95,
      w: 2,
      h: 0.26,
      align: 'right',
      fontFace,
      fontSize: 11,
      color: palette.accent,
    })
  }
  const id = randomUUID()
  const name = `${title.replace(/[<>:"/\\|?*\r\n]/g, ' ').trim() || 'Uni 演示文稿'}.pptx`
  return {
    id,
    name,
    content: Buffer.from(await deck.write({ outputType: 'nodebuffer' })),
    pages: slides.length,
  }
}
