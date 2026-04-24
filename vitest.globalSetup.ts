import { spawn } from 'node:child_process'
import getPort from 'get-port'
import waitPort from 'wait-port'
import { resolve } from 'node:path'

export default async function() {
  // If the caller already provided a live server URL, skip spawning.
  if (process.env.LIVE_SERVER_URL) {
    process.env.TEST_BASE_URL = process.env.LIVE_SERVER_URL;
    process.env.LIVE_PING = '1';
    return;
  }

  // 优先 8787，占用则自动换
  const port = await getPort({ port: 8787 })
  const host = '127.0.0.1' // ✅ 强制 IPv4，绕开 ::1

  // 传给被测服务的环境变量（你服务端代码要用 process.env.PORT / HOST）
  const env = { ...process.env, PORT: String(port), HOST: host }

  const tsxPath = resolve(process.cwd(), 'node_modules/tsx/dist/cli.mjs')
  const child = spawn(
    process.execPath,
    [tsxPath, '--tsconfig', 'reading-app-server/tsconfig.json', 'reading-app-server/src/main.ts'],
    { env, stdio: 'inherit' }
  )

  // 等待端口可用（避免“刚起就请求”）
  await waitPort({ host, port, timeout: 15000 })

  // 暴露给测试使用（在测试里用 process.env.TEST_BASE_URL）
  process.env.TEST_BASE_URL = `http://${host}:${port}`
  process.env.LIVE_PING = '1'

  // 返回 teardown
  return async () => {
    child.kill('SIGTERM')
  }
}
