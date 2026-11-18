import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
  scrypt,
  timingSafeEqual,
} from 'node:crypto'
import { readFile, writeFile, mkdir } from 'node:fs/promises'
import path from 'node:path'
import { promisify } from 'node:util'
import { config } from './config.js'

const scryptAsync = promisify(scrypt)
let encryptionSecret

export const createToken = () => randomBytes(32).toString('base64url')
export const hashToken = (token) => createHash('sha256').update(token).digest('hex')

export async function hashPassword(password) {
  const salt = randomBytes(16).toString('hex')
  const derived = await scryptAsync(password, salt, 64)
  return `${salt}:${Buffer.from(derived).toString('hex')}`
}

export async function verifyPassword(password, stored) {
  const [salt, key] = stored.split(':')
  if (!salt || !key) {
    return false
  }
  const derived = Buffer.from(await scryptAsync(password, salt, 64))
  const expected = Buffer.from(key, 'hex')
  return derived.length === expected.length && timingSafeEqual(derived, expected)
}

async function getEncryptionSecret() {
  if (encryptionSecret) {
    return encryptionSecret
  }
  if (config.appSecret) {
    encryptionSecret = createHash('sha256').update(config.appSecret).digest()
    return encryptionSecret
  }
  await mkdir(config.dataDir, { recursive: true })
  const file = path.join(config.dataDir, '.app-secret')
  try {
    const value = (await readFile(file, 'utf8')).trim()
    if (!value) {
      throw new Error('Empty APP_SECRET file')
    }
    encryptionSecret = Buffer.from(value, 'base64')
  } catch (error) {
    if (error.code !== 'ENOENT') {
      throw error
    }
    const value = randomBytes(32)
    await writeFile(file, value.toString('base64'), { mode: 0o600 })
    encryptionSecret = value
  }
  return encryptionSecret
}

export async function encryptSecret(value) {
  const iv = randomBytes(12)
  const cipher = createCipheriv('aes-256-gcm', await getEncryptionSecret(), iv)
  const encrypted = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()])
  return [iv, cipher.getAuthTag(), encrypted].map((part) => part.toString('base64url')).join('.')
}

export async function decryptSecret(value) {
  const [iv, tag, encrypted] = value.split('.').map((part) => Buffer.from(part, 'base64url'))
  const decipher = createDecipheriv('aes-256-gcm', await getEncryptionSecret(), iv)
  decipher.setAuthTag(tag)
  return Buffer.concat([decipher.update(encrypted), decipher.final()]).toString('utf8')
}

export const publicUser = (user) => ({
  id: user.id,
  email: user.email,
  name: user.name,
  createdAt: user.createdAt,
  keyMode: user.keyMode,
  selectedModel: user.selectedModel ?? config.defaultModel,
  hasStoredKey: Boolean(user.apiKeyEncrypted),
})
