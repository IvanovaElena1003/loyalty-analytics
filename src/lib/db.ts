import { supabase } from './supabase'
import type { RawRow } from '../types'

const BUCKET = 'loyalty-data'
const MAIN_FILE = 'main_rows.json.gz'
const AGENT_FILE = 'agent_rows.json.gz'

const MAIN_FIELDS = [
  'CreateDate', 'State', 'LoyaltyPointsInLK', 'LoyaltyPointsScoring',
  'CrossIsBought', 'FinalPrice', 'PolicyPrice', 'ChargedToIncreasedKV',
  'RenId', 'Role', 'FullName', 'AgentName', 'CashbookId', 'HeadPartnerCB',
] as const

const AGENT_FIELDS = [
  'subj_id', 'ДИВИЗИОН', 'ФИЛИАЛ', 'УПРАВЛЕНИЕ', 'КОД_КП', 'КУРАТОР', 'ПОСРЕДНИК',
] as const

function parseYear(value: unknown): number | null {
  if (!value) return null
  if (value instanceof Date) return value.getFullYear()
  if (typeof value === 'number') return new Date((value - 25569) * 86400000).getFullYear()
  if (typeof value === 'string') { const d = new Date(value); return isNaN(d.getTime()) ? null : d.getFullYear() }
  return null
}

function slim(rows: RawRow[], fields: readonly string[]): Record<string, unknown>[] {
  return rows.map(r => {
    const obj: Record<string, unknown> = {}
    for (const k of fields) obj[k] = r[k] ?? null
    return obj
  })
}

async function gzip(text: string): Promise<Blob> {
  const stream = new Blob([text]).stream().pipeThrough(new CompressionStream('gzip'))
  return new Response(stream).blob()
}

async function gunzip(blob: Blob): Promise<string> {
  const stream = blob.stream().pipeThrough(new DecompressionStream('gzip'))
  return new Response(stream).text()
}

async function downloadJson(file: string): Promise<unknown[] | null> {
  if (!supabase) return null
  const { data, error } = await supabase.storage.from(BUCKET).download(file)
  if (error || !data) return null
  const text = await gunzip(data)
  return JSON.parse(text) as unknown[]
}

async function uploadJson(file: string, rows: unknown[]): Promise<void> {
  if (!supabase) throw new Error('Supabase не настроен')
  const blob = await gzip(JSON.stringify(rows))
  const { error } = await supabase.storage.from(BUCKET).upload(file, blob, {
    upsert: true,
    contentType: 'application/gzip',
  })
  if (error) throw new Error(`Storage upload error: ${error.message}`)
}

export async function loadMainRowsFromDB(): Promise<RawRow[] | null> {
  const rows = await downloadJson(MAIN_FILE)
  return rows ? (rows as RawRow[]) : null
}

export async function loadAgentRowsFromDB(): Promise<RawRow[] | null> {
  const rows = await downloadJson(AGENT_FILE)
  return rows ? (rows as RawRow[]) : null
}

export async function saveMainRowsToDB(rows: RawRow[]): Promise<void> {
  const rows2026 = rows.filter(r => parseYear(r.CreateDate) === 2026)
  await uploadJson(MAIN_FILE, slim(rows2026, MAIN_FIELDS))
}

export async function saveAgentRowsToDB(rows: RawRow[]): Promise<void> {
  await uploadJson(AGENT_FILE, slim(rows, AGENT_FIELDS))
}
