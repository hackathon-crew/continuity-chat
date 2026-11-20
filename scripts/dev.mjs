import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'

const fake = process.argv.includes('--fake')
if (!fake && existsSync('.env')) {
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
const viteArgs = ['--port', publicPort]
const children = [
  spawn(process.execPath, ['server/index.ts'], { stdio: 'inherit', env }),
  fake
    ? spawn(process.execPath, ['node_modules/vite/bin/vite.js', ...viteArgs], {
        stdio: 'inherit',
        env,
      })
    : spawn('pnpm', ['exec', 'vite', ...viteArgs], { stdio: 'inherit', env }),
]

/** @param {number | string} [code] */
function close(code = 0) {
  process.exitCode = code
  children.forEach((child) => child.kill('SIGTERM'))
}
for (const child of children) {
  child.once('exit', (code) => close(code ?? process.exitCode ?? 0))
}
process.once('SIGINT', () => close())
process.once('SIGTERM', () => close())
