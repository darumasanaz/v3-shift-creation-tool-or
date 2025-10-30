import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { execFile } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);
const frontendDir = fileURLToPath(new URL('.', import.meta.url));

const solveApiPlugin = () => ({
  name: 'dev-solve-api',
  apply: 'serve' as const,
  configureServer(server: import('vite').ViteDevServer) {
    server.middlewares.use('/api/solve', (req, res) => {
      if (req.method !== 'POST') {
        res.statusCode = 405;
        res.setHeader('Content-Type', 'application/json');
        res.end(JSON.stringify({ error: 'Method not allowed' }));
        return;
      }

      req.setEncoding('utf-8');
      let rawBody = '';
      req.on('data', (chunk) => {
        rawBody += chunk;
      });
      req.on('end', async () => {
        let payload: unknown;
        try {
          payload = rawBody.length > 0 ? JSON.parse(rawBody) : {};
        } catch (error) {
          console.error('[dev-solve-api] Failed to parse request body', error);
          res.statusCode = 400;
          res.setHeader('Content-Type', 'application/json');
          res.end(JSON.stringify({ error: 'Invalid JSON body.' }));
          return;
        }

        let tempDir: string | null = null;
        try {
          tempDir = await mkdtemp(join(tmpdir(), 'solver-'));
          const inputPath = join(tempDir, 'input.json');
          const outputPath = join(tempDir, 'output.json');

          await writeFile(inputPath, JSON.stringify(payload));
          await execFileAsync('python', ['../solver/solver.py', '--in', inputPath, '--out', outputPath, '--time_limit', '60'], {
            cwd: frontendDir,
          });

          const outputText = await readFile(outputPath, 'utf-8');
          res.statusCode = 200;
          res.setHeader('Content-Type', 'application/json');
          res.end(outputText);
        } catch (error) {
          console.error('[dev-solve-api] Solver execution failed', error);
          res.statusCode = 500;
          res.setHeader('Content-Type', 'application/json');
          res.end(
            JSON.stringify({
              error:
                'Solver execution failed. run_all.sh を実行して依存関係が揃っているか、開発サーバーのログを確認してください。',
            }),
          );
        } finally {
          if (tempDir) {
            await rm(tempDir, { recursive: true, force: true });
          }
        }
      });
      req.on('error', (error) => {
        console.error('[dev-solve-api] Request stream error', error);
        if (!res.writableEnded) {
          res.statusCode = 400;
          res.setHeader('Content-Type', 'application/json');
          res.end(JSON.stringify({ error: 'Failed to read request body.' }));
        }
      });
    });
  },
});

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react(), solveApiPlugin()],
  server: { host: true, port: 5173, strictPort: true },
});
