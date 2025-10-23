import { spawn } from 'node:child_process'
import getPort from 'get-port'
import waitPort from 'wait-port'

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

  // 👇 请改成你 reading-app-server 的入口（ts-node / node dist 都行）
  const child = spawn(
    'node',
    ['reading-app-server/dist/index.js'],
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
