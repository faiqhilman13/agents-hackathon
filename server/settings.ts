import { chmodSync, existsSync, readFileSync, writeFileSync, renameSync } from 'node:fs';
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';
import { z } from 'zod';

export type Settings = { exaKey: string; llmKey: string; llmBaseUrl: string; model: string };
export const DEFAULT_MODEL = 'deepseek/deepseek-v4-flash-0731';
export function modelRequestOptions(settings:Pick<Settings,'llmBaseUrl'|'model'>) {
  try {
    if(settings.model===DEFAULT_MODEL && new URL(settings.llmBaseUrl).hostname.toLowerCase()==='openrouter.ai') {
      return {reasoning:{enabled:false}} as const;
    }
  } catch { /* validated settings normally make this unreachable */ }
  return {};
}
const providerUrl = z.string().url().refine(value => {
  const url = new URL(value);
  return !url.username && !url.password && (url.protocol === 'https:' ||
    (url.protocol === 'http:' && ['localhost', '127.0.0.1'].includes(url.hostname)));
}, 'Use an HTTPS provider endpoint or a local model.');
export const settingsPatchSchema = z.object({
  exaKey: z.string().max(500).optional(),
  llmKey: z.string().max(500).optional(),
  model: z.string().trim().min(1).max(150).optional(),
  llmBaseUrl: providerUrl.optional()
}).strict();

const storedSettingsSchema = settingsPatchSchema.strip();
const DEFAULT_LLM_URL = 'https://openrouter.ai/api/v1';

export class Configuration {
  token: string;
  constructor(private dir: string) {
    const file = join(dir, 'connection-token');
    const existing = existsSync(file) ? readFileSync(file, 'utf8').trim() : '';
    this.token = /^[a-f0-9]{64}$/.test(existing) ? existing : randomBytes(32).toString('hex');
    if (this.token !== existing) writeFileSync(file, this.token, { mode: 0o600 });
    chmodSync(file, 0o600);
  }
  private disk(): Partial<Settings> {
    try {
      const parsed = storedSettingsSchema.safeParse(JSON.parse(readFileSync(join(this.dir, 'settings.json'), 'utf8')));
      return parsed.success ? parsed.data : {};
    } catch { return {}; }
  }
  get(): Settings {
    const disk = this.disk();
    const envUrl = providerUrl.safeParse(process.env.LLM_BASE_URL);
    const envModel = z.string().trim().min(1).max(150).safeParse(process.env.LLM_MODEL);
    return {
      exaKey: disk.exaKey ?? process.env.EXA_API_KEY ?? '',
      llmKey: disk.llmKey ?? process.env.LLM_API_KEY ?? process.env.OPENROUTER_API_KEY ?? '',
      llmBaseUrl: disk.llmBaseUrl ?? (envUrl.success ? envUrl.data : DEFAULT_LLM_URL),
      model: disk.model ?? (envModel.success ? envModel.data : DEFAULT_MODEL)
    };
  }
  public() { const s = this.get(); return { exa:!!s.exaKey, llm:!!s.llmKey, llmBaseUrl:s.llmBaseUrl, model:s.model }; }
  save(patch: Partial<Settings>) {
    const settings = storedSettingsSchema.parse({ ...this.disk(), ...patch });
    const tmp = join(this.dir,'settings.tmp');
    writeFileSync(tmp, JSON.stringify(settings), {mode:0o600});
    chmodSync(tmp, 0o600);
    renameSync(tmp, join(this.dir,'settings.json'));
    return this.public();
  }
}
