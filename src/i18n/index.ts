import { historyMessages } from './zh.js'

export type TranslationKey = keyof typeof historyMessages
export type TranslationMessage = { key: TranslationKey; params?: Record<string, string | number> }

export const isTranslationKey = (key: unknown): key is TranslationKey =>
  typeof key === 'string' && Object.hasOwn(historyMessages, key)
export function translate(key: TranslationKey, params?: Record<string, string | number>) {
  const message = historyMessages[key]
  return params
    ? message.replace(/\{(\w+)\}/g, (match, name: string) => String(params[name] ?? match))
    : message
}
