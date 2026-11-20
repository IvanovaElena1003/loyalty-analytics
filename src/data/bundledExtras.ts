import type { RawRow } from '../types'
import type { SliderQuoteRow } from '../utils/loyaltyBalances'

/** КАСКО и ползунок — статические файлы в сборке Vercel, без Supabase. */
export const BUNDLED_LOYALTY_META = {
  embeddedAt: '2026-11-20',
  osago2025Source: 'статистика лояльность. 2025 для дашбордов.xlsx (авг–дек 2025)',
  kaskoSource: 'Каско котировки лояльность 01.08-18.11.xlsx',
  sliderSource: 'Списание рен-бонусов ползунок_ОСАГО.xlsx',
} as const

let loadPromise: Promise<{
  osago2025: RawRow[]
  kasko: RawRow[]
  slider: SliderQuoteRow[]
}> | null = null

export function loadBundledLoyaltyExtras(): Promise<{
  osago2025: RawRow[]
  kasko: RawRow[]
  slider: SliderQuoteRow[]
}> {
  if (!loadPromise) {
    loadPromise = Promise.all([
      fetch(`${import.meta.env.BASE_URL}data/bundled-osago-2025.json`).then(r => {
        if (!r.ok) throw new Error('bundled-osago-2025.json')
        return r.json() as Promise<RawRow[]>
      }),
      fetch(`${import.meta.env.BASE_URL}data/bundled-kasko.json`).then(r => {
        if (!r.ok) throw new Error('bundled-kasko.json')
        return r.json() as Promise<RawRow[]>
      }),
      fetch(`${import.meta.env.BASE_URL}data/bundled-slider-quotes.json`).then(r => {
        if (!r.ok) throw new Error('bundled-slider-quotes.json')
        return r.json() as Promise<SliderQuoteRow[]>
      }),
    ]).then(([osago2025, kasko, slider]) => ({ osago2025, kasko, slider }))
  }
  return loadPromise
}