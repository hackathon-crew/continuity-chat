import { randomUUID } from 'node:crypto'
import { HttpError } from '../http.ts'
import type { AttachmentInput } from '../types.ts'

export const inlineImageTypes = new Set([
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/gif',
  'image/bmp',
  'image/avif',
  'image/tiff',
])

export function newAttachment(file: AttachmentInput) {
  const text = file?.type === 'text/plain' || file.type === 'text/markdown'
  const image = inlineImageTypes.has(file?.type as string)
  if (typeof file?.name !== 'string' || typeof file.data !== 'string' || !(text || image)) {
    throw new HttpError(400, '聊天附件支持文本和常见图片', 'invalid_attachment')
  }
  const data = Buffer.from(file.data, 'base64')
  if (data.length > 8 * 1024 * 1024) {
    throw new HttpError(413, '单个附件最多 8 MB', 'body_too_large')
  }
  return { id: randomUUID(), name: file.name.slice(0, 200), type: file.type, data, available: true }
}
