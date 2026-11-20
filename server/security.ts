import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto'

export const createToken = () => randomBytes(32).toString('base64url')
export const hashToken = (token: string) => createHash('sha256').update(token).digest('base64url')

export function encrypt(value: string, key: string, context: string) {
  const nonce = randomBytes(12)
  const cipher = createCipheriv('aes-256-gcm', Buffer.from(key, 'hex'), nonce)
  cipher.setAAD(Buffer.from(context))
  const ciphertext = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()])
  return Buffer.concat([nonce, cipher.getAuthTag(), ciphertext]).toString('base64url')
}

export function decrypt(value: string, key: string, context: string) {
  const packet = Buffer.from(value, 'base64url')
  const decipher = createDecipheriv('aes-256-gcm', Buffer.from(key, 'hex'), packet.subarray(0, 12))
  decipher.setAAD(Buffer.from(context))
  decipher.setAuthTag(packet.subarray(12, 28))
  return Buffer.concat([decipher.update(packet.subarray(28)), decipher.final()]).toString('utf8')
}
