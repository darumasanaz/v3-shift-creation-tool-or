import { defineConfig } from 'vite';
import type { PluginOption, ViteDevServer } from 'vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { IncomingMessage, ServerResponse } from 'node:http';
import { promises as fs } from 'node:fs';
import { tmpdir } from 'node:os';
import { spawn } from 'node:child_process';

const repoRoot = fileURLToPath(new URL('..', import.meta.url));
const solverScript = join(repoRoot, 'solver', 'solver.py');
const solverInputPath = join(repoRoot, 'solver', 'input.json');
const solverOutputPath = join(repoRoot, 'solver', 'output.json');
const exportScript = join(repoRoot, 'solver', 'export_xlsx.py');

const EXCEL_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
const MAX_STDERR_LINES = 20;

function readRequestBody(req: IncomingMessage): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on('data', (chunk) => {
      chunks.push(typeof chunk === 'string' ? Buffer.from(chunk) : chunk);
    });
    req.on('end', () => {
      resolve(Buffer.concat(chunks));
    });
    req.on('error', reject);
  });
}

function getPythonExecutable(): string {
  if (process.env.PYTHON) return process.env.PYTHON;
  if (process.env.PY) return process.env.PY;
  return process.platform === 'win32' ? 'python' : 'python3';
}

function formatStderrMessage(base: string, stderr: string): string {
  const trimmed = stderr.trim();
  if (!trimmed) {
    return base;
  }
  const lines = trimmed.split(/\r?\n/).filter((line) => line.trim().length > 0).slice(0, MAX_STDERR_LINES);
  if (lines.length === 0) {
    return base;
  }
  return `${base}\nstderr (先頭${MAX_STDERR_LINES}行):\n${lines.join('\n')}`;
}

async function ensureJsonObject(body: Buffer, res: ServerResponse): Promise<Record<string, unknown> | null> {
  let parsed: unknown;
  const text = body.toString('utf-8') || '{}';
  try {
    parsed = JSON.parse(text);
  } catch (error) {
    res.statusCode = 400;
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({ ok: false, error: 'リクエストボディが JSON として解析できませんでした。' }));
    return null;
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    res.statusCode = 400;
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({ ok: false, error: 'JSON オブジェクトを送信してください。' }));
    return null;
  }
  return parsed as Record<string, unknown>;
}

async function runProcess(command: string, args: string[], options: { cwd: string }) {
  const child = spawn(command, args, { cwd: options.cwd });
  let stdout = '';
  let stderr = '';
  child.stdout?.on('data', (chunk) => {
    stdout += chunk.toString();
  });
  child.stderr?.on('data', (chunk) => {
    stderr += chunk.toString();
  });
  const exitCode: number = await new Promise((resolve, reject) => {
    child.on('error', reject);
    child.on('close', (code) => resolve(code ?? 1));
  });
  return { exitCode, stdout, stderr };
}

function buildSolverPlugin(): PluginOption {
  let solving = false;
  return {
    name: 'local-solver-runner',
    configureServer(server: ViteDevServer) {
      server.middlewares.use('/api/solve', (req: IncomingMessage, res: ServerResponse, next: () => void) => {
        if (req.method !== 'POST') {
          next();
          return;
        }
        if (solving) {
          res.statusCode = 409;
          res.setHeader('Content-Type', 'application/json');
          res.end(JSON.stringify({ ok: false, error: 'solver 実行中です。完了するまでお待ちください。' }));
          return;
        }
        solving = true;
        (async () => {
          const body = await readRequestBody(req);
          const payload = await ensureJsonObject(body, res);
          if (!payload) {
            return;
          }

          const url = new URL(req.url ?? '', 'http://localhost');
          const timeLimitEnv = Number(process.env.SOLVER_TIME_LIMIT ?? '60');
          let timeLimit = Number.isFinite(timeLimitEnv) && timeLimitEnv > 0 ? timeLimitEnv : 60;
          const timeLimitParam = url.searchParams.get('time_limit');
          if (timeLimitParam) {
            const parsed = Number(timeLimitParam);
            if (!Number.isFinite(parsed) || parsed <= 0) {
              res.statusCode = 400;
              res.setHeader('Content-Type', 'application/json');
              res.end(JSON.stringify({ ok: false, error: 'time_limit は正の数値で指定してください。' }));
              return;
            }
            timeLimit = parsed;
          }

          await fs.writeFile(solverInputPath, JSON.stringify(payload, null, 2), 'utf-8');
          const python = getPythonExecutable();
          const { exitCode, stdout, stderr } = await runProcess(
            python,
            [
              solverScript,
              '--in',
              solverInputPath,
              '--out',
              solverOutputPath,
              '--time_limit',
              String(timeLimit),
            ],
            { cwd: repoRoot },
          );

          if (exitCode !== 0) {
            const message = formatStderrMessage('solver 実行に失敗しました。', stderr);
            res.statusCode = 500;
            res.setHeader('Content-Type', 'application/json');
            res.end(JSON.stringify({ ok: false, error: message }));
            return;
          }

          let outputRaw: string;
          try {
            outputRaw = await fs.readFile(solverOutputPath, 'utf-8');
          } catch (error) {
            const message = formatStderrMessage('solver 出力ファイルの読み込みに失敗しました。', stderr);
            res.statusCode = 500;
            res.setHeader('Content-Type', 'application/json');
            res.end(JSON.stringify({ ok: false, error: message }));
            return;
          }

          let outputJson: unknown;
          try {
            outputJson = JSON.parse(outputRaw);
          } catch (error) {
            res.statusCode = 500;
            res.setHeader('Content-Type', 'application/json');
            res.end(JSON.stringify({ ok: false, error: 'solver 出力が JSON として解析できませんでした。' }));
            return;
          }

          if (!outputJson || typeof outputJson !== 'object') {
            res.statusCode = 500;
            res.setHeader('Content-Type', 'application/json');
            res.end(JSON.stringify({ ok: false, error: 'solver 出力が JSON オブジェクトではありません。' }));
            return;
          }

          const trimmedStdout = stdout.trim();
          if (trimmedStdout) {
            const diagnosticsKey = (outputJson as Record<string, unknown>).diagnostics;
            if (diagnosticsKey && typeof diagnosticsKey === 'object' && !Array.isArray(diagnosticsKey)) {
              const diagnostics = diagnosticsKey as Record<string, unknown>;
              const previousLog = typeof diagnostics.logOutput === 'string' ? diagnostics.logOutput.trim() : '';
              diagnostics.logOutput = previousLog ? `${previousLog}\n${trimmedStdout}` : trimmedStdout;
            } else {
              (outputJson as Record<string, unknown>).diagnostics = { logOutput: trimmedStdout };
            }
          }

          res.statusCode = 200;
          res.setHeader('Content-Type', 'application/json');
          res.end(JSON.stringify({ ok: true, output: outputJson }));
        })()
          .catch((error) => {
            console.error('[solver] unexpected error', error);
            if (!res.headersSent) {
              res.statusCode = 500;
              res.setHeader('Content-Type', 'application/json');
              res.end(JSON.stringify({ ok: false, error: 'solver 実行中に予期しないエラーが発生しました。' }));
            }
          })
          .finally(() => {
            solving = false;
          });
      });

      server.middlewares.use('/api/export-xlsx', (req: IncomingMessage, res: ServerResponse, next: () => void) => {
        if (req.method !== 'POST') {
          next();
          return;
        }

        (async () => {
          const body = await readRequestBody(req);
          const payload = await ensureJsonObject(body, res);
          if (!payload) {
            return;
          }

          const tempDir = await fs.mkdtemp(join(tmpdir(), 'shift-export-'));
          const inputPath = join(tempDir, 'input.json');
          const outputPath = join(tempDir, 'schedule.xlsx');

          try {
            await fs.writeFile(inputPath, JSON.stringify(payload, null, 2), 'utf-8');
            const python = getPythonExecutable();
            const { exitCode, stderr } = await runProcess(
              python,
              [exportScript, '--in', inputPath, '--out', outputPath],
              { cwd: repoRoot },
            );
            if (exitCode !== 0) {
              const message = formatStderrMessage('Excel 生成に失敗しました。', stderr);
              res.statusCode = 500;
              res.setHeader('Content-Type', 'application/json');
              res.end(JSON.stringify({ ok: false, error: message }));
              return;
            }

            const workbook = await fs.readFile(outputPath);
            res.statusCode = 200;
            res.setHeader('Content-Type', EXCEL_MIME);
            res.setHeader('Content-Disposition', 'attachment; filename="shift-schedule.xlsx"');
            res.end(workbook);
          } finally {
            await fs.rm(tempDir, { recursive: true, force: true });
          }
        })().catch((error) => {
          console.error('[export-xlsx] unexpected error', error);
          if (!res.headersSent) {
            res.statusCode = 500;
            res.setHeader('Content-Type', 'application/json');
            res.end(JSON.stringify({ ok: false, error: 'Excel 生成中に予期しないエラーが発生しました。' }));
          }
        });
      });
    },
  };
}

export default defineConfig({
  plugins: [react(), buildSolverPlugin()],
  server: {
    host: true,
    port: 5173,
    strictPort: true,
    fs: { allow: [repoRoot] },
  },
  resolve: {
    alias: {
      '@solver': join(repoRoot, 'solver'),
    },
  },
});
