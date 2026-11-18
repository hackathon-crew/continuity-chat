import { spawn } from 'node:child_process'

const children = []
const run = (command, args, env = {}) => {
  const child = spawn(command, args, {
    stdio: 'inherit',
    env: { ...process.env, PORT: '3080', PUBLIC_URL: 'http://localhost:8090', ...env },
  })
  children.push(child)
  return child
}

const server = run(process.execPath, ['--env-file-if-exists=.env', 'server/index.js'])
const web = run('pnpm', ['exec', 'rspack', 'serve', '-c', 'rspack.config.ts'])
let closing = false

const close = (code = 0) => {
  if (closing) {
    return
  }
  closing = true
  children.forEach((child) => child.kill('SIGTERM'))
  setTimeout(() => process.exit(code), 100).unref()
}

server.on('exit', (code) => {
  if (!closing && code) {
    close(code)
  }
})
web.on('exit', (code) => {
  if (!closing) {
    close(code ?? 0)
  }
})
process.on('SIGINT', () => close())
process.on('SIGTERM', () => close())
