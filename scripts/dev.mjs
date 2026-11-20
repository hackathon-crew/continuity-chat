import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'

if (existsSync('.env')) {
  process.loadEnvFile('.env')
}

const publicPort = process.env.PORT ?? '3080'
const backendPort = Number(publicPort) + 1
const env = {
  ...process.env,
  PORT: String(backendPort),
  PUBLIC_URL: process.env.PUBLIC_URL ?? `http://localhost:${publicPort}`,
  UNIGATE_CHAT_DEV_BACKEND: `http://127.0.0.1:${backendPort}`,
}
const children = [
  spawn(process.execPath, ['server/index.ts'], { stdio: 'inherit', env }),
  spawn('pnpm', ['exec', 'vite', '--port', publicPort], { stdio: 'inherit', env }),
]

function close(code = 0) {
  process.exitCode = code
  children.forEach((child) => child.kill('SIGTERM'))
}
for (const child of children) {
  child.once('exit', (code) => close(code ?? process.exitCode ?? 0))
}
process.once('SIGINT', () => close())
process.once('SIGTERM', () => close())
