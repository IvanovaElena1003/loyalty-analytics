export interface RawRow {
  CreateDate: number | string | Date
  State: string
  LoyaltyPointsInLK: number | string | null
  CrossIsBought: string
  FinalPrice: number | string | null
  ChargedToIncreasedKV: number | string | null
  [key: string]: unknown
}

export interface MonthMetrics {
  label: string   // "Мар 2025"
  sortKey: string // "2025-03"
  min_date: string // "2025-08-01" — первая дата в месяце
  max_date: string // "2025-08-31" — последняя дата в месяце

  // Block 1 — Котировки ОСАГО ФЛ
  total_quotes: number
  quotes_no_bonus: number
  quotes_with_bonus: number
  pct_quotes_bonus: number | null

  // Block 2 — Оформление ОСАГО ФЛ
  issued_total: number
  issued_no_bonus: number
  issued_with_bonus: number
  conversion: number | null
  pct_issued_bonus: number | null

  // Block 3 — Кросс-Каско от бесполисных
  cross_total: number
  cross_no_bonus: number
  cross_with_bonus: number
  conv_cross: number | null
  conv_cross_nb: number | null
  conv_cross_wb: number | null

  // Block 4 — Состав Кросс-Каско
  cross_base: number
  cross_discount: number
  cross_incr_kv: number

  // Block 5 — Рен-бонусы
  bonus_accrued: number
  bonus_spent_discount: number
  bonus_spent_kv: number
  bonus_spent_total: number
}

export interface AggregateResult {
  months: MonthMetrics[]
  totals: MonthMetrics
}
