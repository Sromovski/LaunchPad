/**
 * Locates external binaries (ffmpeg, ffprobe, whisper.cpp). Each can be
 * overridden with an env var; otherwise we look on PATH, then in known
 * install locations. winget installs ffmpeg without always updating PATH for
 * already-open shells, so we fall back to its package folder on Windows.
 */
import { spawnSync } from 'node:child_process';
import { existsSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { PROJECT_ROOT } from '../db/index.js';

const IS_WIN = process.platform === 'win32';
const exe = (name: string) => (IS_WIN ? `${name}.exe` : name);

function onPath(cmd: string): boolean {
  const r = spawnSync(cmd, ['-version'], { stdio: 'ignore' });
  return !r.error;
}

function findInWinget(binary: string): string | undefined {
  const root = process.env.LOCALAPPDATA && join(process.env.LOCALAPPDATA, 'Microsoft/WinGet/Packages');
  if (!root || !existsSync(root)) return undefined;
  for (const pkg of readdirSync(root).filter((d) => /ffmpeg/i.test(d))) {
    for (const build of readdirSync(join(root, pkg))) {
      const candidate = join(root, pkg, build, 'bin', exe(binary));
      if (existsSync(candidate)) return candidate;
    }
  }
  return undefined;
}

function resolveFfTool(name: 'ffmpeg' | 'ffprobe', envVar: string): string | undefined {
  const fromEnv = process.env[envVar];
  if (fromEnv) return existsSync(fromEnv) ? fromEnv : undefined;
  if (onPath(name)) return name;
  return IS_WIN ? findInWinget(name) : undefined;
}

export const ffmpegPath = () => resolveFfTool('ffmpeg', 'FFMPEG_PATH');
export const ffprobePath = () => resolveFfTool('ffprobe', 'FFPROBE_PATH');

export function whisperBinPath(): string | undefined {
  const p = process.env.WHISPER_BIN ?? resolve(PROJECT_ROOT, 'tools/whisper/Release', exe('whisper-cli'));
  return existsSync(p) ? p : undefined;
}

export function whisperModelPath(): string | undefined {
  const p = process.env.WHISPER_MODEL ?? resolve(PROJECT_ROOT, 'tools/whisper/ggml-base.en.bin');
  return existsSync(p) ? p : undefined;
}
