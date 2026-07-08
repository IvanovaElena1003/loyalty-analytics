export interface RawRow {
  CreateDate: number | string | Date
  State: string
  LoyaltyPointsInLK: number | string | null
  LoyaltyPointsScoring: number | string | null  // значение с дробной частью; InLK = floor(Scoring)
  CrossIsBought: string
  FinalPrice: number | string | null
  PolicyPrice?: number | string | null   // базовая цена полиса (если есть в данных, иначе 2490)
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

  // Block 4 — Состав Кросс-Каско (условия независимы: строка может попасть в обе категории)
  cross_base: number      // FinalPrice = PolicyPrice И ChargedToIncreasedKV = 0
  cross_discount: number  // FinalPrice ≠ PolicyPrice (независимо от КВ)
  cross_incr_kv: number   // ChargedToIncreasedKV ≠ 0 (независимо от скидки)

  // Block 5 — Рен-бонусы
  accrual_count: number       // кол-во событий начисления: PolicyIssued И LoyaltyPointsInLK > 0
  bonus_accrued: number       // сумма LoyaltyPointsInLK для тех же строк
  bonus_spent_discount: number
  bonus_spent_kv: number
  bonus_spent_total: number
}

export interface DistributionBucket {
  label: string
  from: number
  to: number
  count: number
  pct: number
}

export interface DistributionData {
  count: number
  mean: number
  std: number
  buckets: DistributionBucket[]
}

export interface AggregateResult {
  months: MonthMetrics[]
  totals: MonthMetrics
  accrualValues: number[]   // LoyaltyPointsInLK per qualifying PolicyIssued row
  spendingValues: number[]  // total spend per CrossIsBought row with spending
  rawRows: RawRow[]         // все исходные строки для вкладки Аномалии
  maxCreateDate: string | null  // YYYY-MM-DD последней котировки
}
