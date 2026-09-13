import { z } from 'zod';

export function publicUrl(value: string): boolean {
  try {
    const u = new URL(value);
    return ['https:', 'http:'].includes(u.protocol) && !u.username && !u.password &&
      !/^(localhost|.*\.localhost|.*\.local|127\..*|0\..*|10\..*|192\.168\..*|169\.254\..*|172\.(1[6-9]|2\d|3[01])\..*|\[.*\])$/i.test(u.hostname) && u.hostname.includes('.');
  } catch { return false; }
}
export const urlSchema = z.string().max(2000).refine(publicUrl, 'Choose a public http or https article.');
export const captureSchema = z.object({
  url: urlSchema, title: z.string().min(1).max(500),
  text: z.string().max(140000), selection: z.string().max(8000).default(''),
  authors: z.array(z.string().max(200)).max(100).default([]),
  description: z.string().max(12000).default(''),
  capturedAt: z.string(), coverage: z.enum(['abstract', 'page', 'full-text', 'visible-content', 'selection', 'unavailable']),
  arxivId: z.string().max(100).optional()
});
export type Capture = z.infer<typeof captureSchema>;
export const researchSchema = z.object({
  requestId: z.string().uuid(), capture: captureSchema,
  question: z.string().max(1000).default(''),
  collection: z.string().trim().max(60).default('Reading list'),
  enrich: z.boolean().default(true)
});
export type ResearchInput = z.infer<typeof researchSchema>;
export const findingSchema = z.object({
  text: z.string().min(1).max(3000), sourceIds: z.array(z.string()).min(1).max(8)
});
export const briefSchema = z.object({
  title: z.string().min(1).max(300), overview: findingSchema,
  takeaways: z.array(findingSchema).max(6),
  connections: z.array(z.object({
    title: z.string().max(180), relationship: z.enum(['builds-on', 'alternative', 'context', 'limitation']),
    text: z.string().max(2000), sourceIds: z.array(z.string()).min(1).max(8)
  })).max(5),
  questions: z.array(z.string().max(400)).max(4), tags: z.array(z.string().max(40)).max(6)
});
export type Brief = z.infer<typeof briefSchema>;
export type Source = {
  id: string; title: string; url: string; text: string; kind: 'original' | 'related';
  publishedDate?: string; authors?: string[]; reason?: string;
};
export type Research = {
  id: string; requestId: string; status: 'queued' | 'running' | 'complete' | 'failed' | 'cancelled';
  stage: string; progress: number; createdAt: string; updatedAt: string; input: ResearchInput;
  sources: Source[]; brief?: Brief; mode: 'synthesis' | 'extractive' | 'demo';
  warnings: string[]; error?: string; notes: string; favorite: boolean; collection: string;
  inLibrary: boolean;
  messages?: { role:'user'|'assistant'; text:string; sourceIds?:string[]; createdAt:string }[];
};
export function arxivId(url: string): string | undefined {
  try {
    const u = new URL(url);
    if (!['arxiv.org', 'www.arxiv.org', 'export.arxiv.org'].includes(u.hostname)) return;
    return u.pathname.match(/^\/(?:abs|html|pdf)\/((?:\d{4}\.\d{4,5}|[a-z-]+(?:\.[A-Z]{2})?\/\d{7})(?:v\d+)?)(?:\.pdf)?\/?$/)?.[1];
  } catch { return; }
}
export function normalizeUrl(value: string): string {
  const id = arxivId(value);
  if (id) return `https://arxiv.org/abs/${id}`;
  const u = new URL(value); u.hash = '';
  for (const key of [...u.searchParams.keys()]) if (/^(utm_|fbclid|gclid)/i.test(key)) u.searchParams.delete(key);
  return u.toString().replace(/\/$/, '');
}
