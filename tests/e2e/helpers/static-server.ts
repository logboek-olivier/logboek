import { createServer, type Server } from 'node:http'
import { existsSync, readFileSync, statSync } from 'node:fs'
import { extname, join, normalize } from 'node:path'

// Kleine statische server voor de upgradetest: dezelfde origin (dus dezelfde browseropslag), maar de map met de
// gebouwde app is om te zetten van de vorige naar de nieuwe release, zoals een deploy op GitHub Pages.

const TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json',
  '.webmanifest': 'application/manifest+json',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.txt': 'text/plain; charset=utf-8',
}

export interface SwitchableServer {
  url: string
  root: string
  close(): Promise<void>
}

export async function startStaticServer(port: number, root: string): Promise<SwitchableServer> {
  const state = { root }
  const server: Server = createServer((request, response) => {
    const path = decodeURIComponent(new URL(request.url ?? '/', 'http://localhost').pathname)
    if (!path.startsWith('/logboek/')) {
      response.writeHead(404).end()
      return
    }
    let file = normalize(join(state.root, path.slice('/logboek/'.length)))
    if (!file.startsWith(normalize(state.root))) {
      response.writeHead(403).end()
      return
    }
    if (!existsSync(file) || statSync(file).isDirectory()) file = join(state.root, 'index.html')
    response.writeHead(200, { 'Content-Type': TYPES[extname(file)] ?? 'application/octet-stream', 'Cache-Control': 'no-cache' })
    response.end(readFileSync(file))
  })
  await new Promise<void>((resolve) => server.listen(port, '127.0.0.1', resolve))
  return {
    url: `http://127.0.0.1:${port}/logboek/`,
    get root() {
      return state.root
    },
    set root(value: string) {
      state.root = value
    },
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  }
}
