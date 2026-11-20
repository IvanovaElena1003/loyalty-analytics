import type { RawRow } from '../types'

/**
 * Исключаем только «внешних» Seller / Продавец (не субучётки партнёра).
 * Участвуют: PartnerDir, PartnerLead, Partnerseller,
 * «Директор партнера», «Куратор внутри партнера», «Продавец внутри партнера» и т.п.
 */
export function isExcludedLoyaltyRole(role: unknown): boolean {
  const r = String(role ?? '').trim()
  return r === 'Seller' || r === 'Продавец'
}

function normCb(v: unknown): string {
  const s = String(v ?? '').trim()
  if (!s || s === '[NULL]' || s.toLowerCase() === 'null') return ''
  return s
}

/**
 * Ключ партнёра (кошелёк): субагенты и продавцы сливаются в HeadPartnerCB;
 * иначе — CashbookId головы.
 */
export function partnerWalletKey(row: RawRow): string {
  if (isExcludedLoyaltyRole(row.Role)) return ''
  const head = normCb(row.HeadPartnerCB)
  if (head) return head
  return normCb(row.CashbookId)
}