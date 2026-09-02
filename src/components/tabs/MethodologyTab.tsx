// ─── Типы ──────────────────────────────────────────────────────────────────────
interface MetricRow {
  label: string          // название как в таблице Воронки
  field?: string         // имя поля из кода (опционально)
  formula: string        // формула / условие расчёта
  note?: string          // дополнительный комментарий
}

interface Section {
  title: string
  color: string          // tailwind border/header color
  metrics: MetricRow[]
}

// ─── Данные ────────────────────────────────────────────────────────────────────
const SECTIONS: Section[] = [
  {
    title: 'Котировки ОСАГО ФЛ',
    color: 'blue',
    metrics: [
      {
        label: 'Котировок ВСЕГО',
        field: 'total_quotes',
        formula: 'Количество строк после исключения аннулированных и расторгнутых полисов',
        note: 'Исключены: State = PolicyAnnulled, PolicyTerminated',
      },
      {
        label: '— без Рен-бонусов',
        field: 'quotes_no_bonus',
        formula: 'Строки где LoyaltyPointsInLK = 0 или null',
        note: '% = quotes_no_bonus / total_quotes',
      },
      {
        label: '— с Рен-бонусами',
        field: 'quotes_with_bonus',
        formula: 'Строки где LoyaltyPointsInLK ≠ 0 и не null',
        note: '% = quotes_with_bonus / total_quotes',
      },
    ],
  },
  {
    title: 'Оформление ОСАГО ФЛ',
    color: 'green',
    metrics: [
      {
        label: 'Оформлено ВСЕГО',
        field: 'issued_total',
        formula: 'State = "PolicyIssued"',
        note: '% (конверсия) = issued_total / total_quotes',
      },
      {
        label: '— без Рен-бонусов',
        field: 'issued_no_bonus',
        formula: 'State = "PolicyIssued" И LoyaltyPointsInLK = 0 или null',
        note: '% = issued_no_bonus / issued_total',
      },
      {
        label: '— с Рен-бонусами',
        field: 'issued_with_bonus',
        formula: 'State = "PolicyIssued" И LoyaltyPointsInLK ≠ 0',
        note: '% = issued_with_bonus / issued_total',
      },
    ],
  },
  {
    title: 'Кросс-Каско от бесполисных',
    color: 'violet',
    metrics: [
      {
        label: 'Оформлен Кросс-Каско ВСЕГО',
        field: 'cross_total',
        formula: 'State = "PolicyIssued" И CrossIsBought = "Да"',
        note: '% (конверсия) = cross_total / issued_total, 1 знак после запятой',
      },
      {
        label: '— без Рен-бонусов',
        field: 'cross_no_bonus',
        formula: 'Кросс куплен И LoyaltyPointsInLK = 0 или null',
        note: '% = cross_no_bonus / issued_no_bonus, 1 знак после запятой',
      },
      {
        label: '— с Рен-бонусами',
        field: 'cross_with_bonus',
        formula: 'Кросс куплен И LoyaltyPointsInLK ≠ 0',
        note: '% = cross_with_bonus / issued_with_bonus, 1 знак после запятой',
      },
    ],
  },
  {
    title: 'Из чего состоит Кросс-Каско',
    color: 'amber',
    metrics: [
      {
        label: '% Повышенное КВ',
        field: 'cross_incr_kv',
        formula: 'State = "PolicyIssued" И CrossIsBought = "Да" И ChargedToIncreasedKV ≠ null и ≠ 0',
        note: 'Условие независимо от FinalPrice — одна строка может попасть и в КВ, и в скидку. % = cross_incr_kv / cross_total',
      },
      {
        label: '% Скидка (Рен-бонусы)',
        field: 'cross_discount',
        formula: 'State = "PolicyIssued" И CrossIsBought = "Да" И FinalPrice ≠ PolicyPrice (2490)',
        note: 'Условие независимо от ChargedToIncreasedKV. % = cross_discount / cross_total',
      },
      {
        label: '% Базовый «Каско от бесполисных»',
        field: 'cross_base',
        formula: 'State = "PolicyIssued" И CrossIsBought = "Да" И FinalPrice = PolicyPrice (2490) И ChargedToIncreasedKV = 0',
        note: 'Ни скидки, ни КВ не применялось. % = cross_base / cross_total',
      },
    ],
  },
  {
    title: 'Рен-бонусы — правила расчёта',
    color: 'rose',
    metrics: [
      {
        label: 'Правило НАЧИСЛЕНИЯ',
        field: 'accrual_count / bonus_accrued',
        formula: 'State = "PolicyIssued" И LoyaltyPointsInLK > 0',
        note: 'accrual_count = кол-во таких строк. bonus_accrued = сумма LoyaltyPointsInLK по ним.',
      },
      {
        label: 'Правило СПИСАНИЯ (любого)',
        formula: 'State = "PolicyIssued" И CrossIsBought = "Да" И (ChargedToIncreasedKV ≠ null ИЛИ FinalPrice ≠ 2490)',
        note: 'Условия КВ и скидки проверяются независимо. Одна строка может попасть в обе категории.',
      },
      {
        label: 'Правило СПИСАНИЯ → скидка КВ',
        field: 'bonus_spent_discount',
        formula: 'State = "PolicyIssued" И CrossIsBought = "Да" И FinalPrice ≠ PolicyPrice (2490) → PolicyPrice − FinalPrice',
        note: 'Сумма скидки = PolicyPrice − FinalPrice. Условие независимо от ChargedToIncreasedKV.',
      },
      {
        label: 'Правило СПИСАНИЯ → повышенное КВ',
        field: 'bonus_spent_kv',
        formula: 'State = "PolicyIssued" И CrossIsBought = "Да" И ChargedToIncreasedKV ≠ null/0 → значение ChargedToIncreasedKV',
        note: 'Поле ChargedToIncreasedKV содержит точную сумму, списанную в повышенное КВ. Условие независимо от FinalPrice.',
      },
      {
        label: 'Всего списано бонусов',
        field: 'bonus_spent_total',
        formula: 'bonus_spent_discount + bonus_spent_kv',
        note: '% = bonus_spent_total / bonus_accrued',
      },
    ],
  },
]

// ─── Цвета секций ──────────────────────────────────────────────────────────────
const COLORS: Record<string, { wrapper: string; badge: string }> = {
  blue:   { wrapper: 'ren-card', badge: 'ren-badge' },
  green:  { wrapper: 'ren-card', badge: 'ren-badge' },
  violet: { wrapper: 'ren-card', badge: 'ren-badge' },
  amber:  { wrapper: 'ren-card', badge: 'ren-badge' },
  rose:   { wrapper: 'ren-card', badge: 'ren-badge' },
}

// ─── Компонент ─────────────────────────────────────────────────────────────────
export default function MethodologyTab() {
  return (
    <div className="space-y-6 max-w-4xl">

      {/* Правила фильтрации */}
      <div className="ren-alert">
        <h2 className="text-sm font-bold uppercase tracking-wide mb-2">Правила фильтрации</h2>
        <p className="text-sm">
          Из всех расчётов исключаются строки со статусами:&nbsp;
          <code className="ren-bg-brand-soft px-1.5 py-0.5 rounded font-mono">PolicyAnnulled</code>
          &nbsp;и&nbsp;
          <code className="ren-bg-brand-soft px-1.5 py-0.5 rounded font-mono">PolicyTerminated</code>.
          Все остальные статусы учитываются.
        </p>
      </div>

      <div className="ren-card ren-card__body ren-bg-brand-soft ren-text-brand text-sm">
        <h2 className="text-sm font-bold uppercase tracking-wide mb-2">Важно: условия списания независимы</h2>
        <p>
          Начиная с текущей версии, условия списания в <strong>скидку КВ</strong> и в <strong>повышенное КВ</strong> проверяются независимо.
          Одна строка может одновременно попасть в оба счётчика, если <code className="ren-bg-brand-soft px-1 rounded font-mono">FinalPrice ≠ 2490</code> <strong>и</strong>{' '}
          <code className="ren-bg-brand-soft px-1 rounded font-mono">ChargedToIncreasedKV ≠ 0</code>.
        </p>
      </div>

      {/* Секции по блокам */}
      {SECTIONS.map(section => {
        const c = COLORS[section.color]
        return (
          <div key={section.title} className={c.wrapper}>
            <div className="ren-card__header">
              <h2 className="ren-card__title text-sm uppercase tracking-wide">{section.title}</h2>
            </div>
            <div className="overflow-x-auto">
              <table className="ren-table w-full text-sm">
                <thead>
                  <tr className="border-b border-[var(--stroke-divider)]">
                    <th className="px-4 py-2.5 text-left text-xs font-semibold ren-text-secondary uppercase tracking-wide w-[220px]">Метрика</th>
                    <th className="px-4 py-2.5 text-left text-xs font-semibold ren-text-secondary uppercase tracking-wide">Формула / условие расчёта</th>
                    <th className="px-4 py-2.5 text-left text-xs font-semibold ren-text-secondary uppercase tracking-wide w-[260px]">Примечание</th>
                  </tr>
                </thead>
                <tbody>
                  {section.metrics.map((m, i) => (
                    <tr key={i} className="border-t border-[var(--stroke-divider)] transition-colors">
                      <td className="px-4 py-3 align-top">
                        <div className="font-medium text-[var(--text-primary)]">{m.label}</div>
                        {m.field && (
                          <div className={`inline-block mt-1 text-[11px] font-mono px-1.5 py-0.5 rounded ${c.badge}`}>
                            {m.field}
                          </div>
                        )}
                      </td>
                      <td className="px-4 py-3 ren-text-secondary align-top">{m.formula}</td>
                      <td className="px-4 py-3 text-xs ren-text-secondary align-top">{m.note ?? ''}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )
      })}

      {/* Маппинг колонок */}
      <div className="ren-card">
        <div className="ren-card__header">
          <h2 className="ren-card__title text-sm uppercase tracking-wide">Маппинг колонок Excel</h2>
        </div>
        <table className="ren-table w-full text-sm">
          <thead>
            <tr className="border-b border-[var(--stroke-divider)]">
              <th className="px-4 py-2.5 text-left text-xs font-semibold ren-text-secondary uppercase tracking-wide w-16">Кол.</th>
              <th className="px-4 py-2.5 text-left text-xs font-semibold ren-text-secondary uppercase tracking-wide">Имя поля</th>
              <th className="px-4 py-2.5 text-left text-xs font-semibold ren-text-secondary uppercase tracking-wide">Описание</th>
            </tr>
          </thead>
          <tbody>
            {[
              ['I',  'CreateDate',            'Дата создания котировки'],
              ['J',  'State',                 'Статус: PolicyIssued / Refused / PolicyAnnulled и др.'],
              ['T',  'LoyaltyPointsInLK',     'Баллы Рен-бонусов в ЛК — текущий баланс агента на момент котировки'],
              ['AF', 'CrossIsBought',         '"Да" / "Нет" — куплен ли Кросс-Каско'],
              ['AG', 'FinalPrice',            'Итоговая цена Кросс-Каско (руб.). PolicyPrice (базовая) = 2490'],
              ['AH', 'ChargedToIncreasedKV',  'Сумма, списанная в повышенное КВ (руб.); null/0 если не применялось'],
            ].map(([col, field, desc]) => (
              <tr key={field} className="border-t border-[var(--stroke-divider)] transition-colors">
                <td className="px-4 py-2.5 font-mono font-bold ren-text-secondary text-center">{col}</td>
                <td className="px-4 py-2.5 font-mono text-[var(--text-primary)]">{field}</td>
                <td className="px-4 py-2.5 ren-text-secondary">{desc}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="ren-card ren-card__body ren-bg-brand-soft ren-text-brand text-sm">
        <strong>Обработка пустых значений:</strong> значение{' '}
        <code className="ren-bg-brand-soft px-1 rounded">[NULL]</code>, пустая строка или отсутствие значения
        интерпретируются как 0. Деление на ноль отображается как «—».
      </div>

    </div>
  )
}
