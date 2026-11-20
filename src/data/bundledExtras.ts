import type { RawRow } from '../types'
import type { SliderQuoteRow } from '../utils/loyaltyBalances'

/** КАСКО и ползунок — статические файлы в сборке Vercel, без Supabase. */
export const BUNDLED_LOYALTY_META = {
  embeddedAt: '2026-11-20',
  osago2025Source:
    'статистика лояльность. 2025 для дашбордов.xlsx (авг–сен, ноя–дек 2025; лист окт. 2025 в источнике пустой)',
  kaskoSource: 'Каско котировки лояльность 01.08-18.11.xlsx',
  sliderSource: 'Списание рен-бонусов ползунок_ОСАГО.xlsx',
} as const

export interface BundledLoyaltyLoad {
  osago2025: RawRow[]
  kasko: RawRow[]
  slider: SliderQuoteRow[]
  errors: string[]
}

let loadPromise: Promise<BundledLoyaltyLoad> | null = null

async function fetchJson<T>(path: string, label: string): Promise<{ data: T | null; err: string | null }> {
  try {
    const r = await fetch(`${import.meta.env.BASE_URL}${path}`)
    if (!r.ok) return { data: null, err: `${label}: HTTP ${r.status}` }
    const data = (await r.json()) as T
  if (Array.isArray(data) && data.length === 0) return { data, err: `${label}: пустой файл` }
    return { data, err: null }
  } catch (e) {
    return { data: null, err: `${label}: ${e instanceof Error ? e.message : String(e)}` }
  }
}

/** Каждый снимок грузится отдельно — падение одного не обнуляет остальные. */
export function loadBundledLoyaltyExtras(): Promise<BundledLoyaltyLoad> {
  if (!loadPromise) {
    loadPromise = (async () => {
      const [os, ka, sl] = await Promise.all([
        fetchJson<RawRow[]>('data/bundled-osago-2025.json', 'ОСАГО 2025'),
        fetchJson<RawRow[]>('data/bundled-kasko.json', 'КАСКО'),
        fetchJson<SliderQuoteRow[]>('data/bundled-slider-quotes.json', 'Ползунок'),
      ])
      const errors = [os.err, ka.err, sl.err].filter((e): e is string => !!e)
      return {
        osago2025: os.data ?? [],
        kasko: ka.data ?? [],
        slider: sl.data ?? [],
        errors,
      }
    })()
  }
  return loadPromise
}

export function resetBundledLoyaltyCache(): void {
  loadPromise = null
}