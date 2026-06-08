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
const COLORS: Record<string, { header: string; label: string; badge: string }> = {
  blue:   { header: 'bg-blue-50 border-blue-200',   label: 'text-blue-800',   badge: 'bg-blue-100 text-blue-700' },
  green:  { header: 'bg-green-50 border-green-200', label: 'text-green-800',  badge: 'bg-green-100 text-green-700' },
  violet: { header: 'bg-violet-50 border-violet-200', label: 'text-violet-800', badge: 'bg-violet-100 text-violet-700' },
  amber:  { header: 'bg-amber-50 border-amber-200', label: 'text-amber-800',  badge: 'bg-amber-100 text-amber-700' },
  rose:   { header: 'bg-rose-50 border-rose-200',   label: 'text-rose-800',   badge: 'bg-rose-100 text-rose-700' },
}

// ─── Компонент ─────────────────────────────────────────────────────────────────
export default function MethodologyTab() {
  return (
    <div className="space-y-6 max-w-4xl">

      {/* Правила фильтрации */}
      <div className="bg-red-50 border border-red-200 rounded-xl p-4">
        <h2 className="text-sm font-bold text-red-800 uppercase tracking-wide mb-2">Правила фильтрации</h2>
        <p className="text-sm text-red-700">
          Из всех расчётов исключаются строки со статусами:&nbsp;
          <code className="bg-red-100 px-1.5 py-0.5 rounded font-mono">PolicyAnnulled</code>
          &nbsp;и&nbsp;
          <code className="bg-red-100 px-1.5 py-0.5 rounded font-mono">PolicyTerminated</code>.
          Все остальные статусы учитываются.
        </p>
      </div>

      {/* Важное замечание о независимости условий */}
      <div className="bg-orange-50 border border-orange-200 rounded-xl p-4">
        <h2 className="text-sm font-bold text-orange-800 uppercase tracking-wide mb-2">Важно: условия списания независимы</h2>
        <p className="text-sm text-orange-700">
          Начиная с текущей версии, условия списания в <strong>скидку КВ</strong> и в <strong>повышенное КВ</strong> проверяются независимо.
          Одна строка может одновременно попасть в оба счётчика, если <code className="bg-orange-100 px-1 rounded font-mono">FinalPrice ≠ 2490</code> <strong>и</strong>{' '}
          <code className="bg-orange-100 px-1 rounded font-mono">ChargedToIncreasedKV ≠ 0</code>.
        </p>
      </div>

      {/* Секции по блокам */}
      {SECTIONS.map(section => {
        const c = COLORS[section.color]
        return (
          <div key={section.title} className={`rounded-xl border ${c.header} overflow-hidden`}>
            <div className={`px-4 py-3 border-b ${c.header}`}>
              <h2 className={`text-sm font-bold uppercase tracking-wide ${c.label}`}>{section.title}</h2>
            </div>
            <div className="bg-white">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-gray-100">
                    <th className="px-4 py-2.5 text-left text-xs font-semibold text-gray-500 uppercase tracking-wide w-[220px]">Метрика</th>
                    <th className="px-4 py-2.5 text-left text-xs font-semibold text-gray-500 uppercase tracking-wide">Формула / условие расчёта</th>
                    <th className="px-4 py-2.5 text-left text-xs font-semibold text-gray-500 uppercase tracking-wide w-[260px]">Примечание</th>
                  </tr>
                </thead>
                <tbody>
                  {section.metrics.map((m, i) => (
                    <tr key={i} className="border-t border-gray-100 hover:bg-gray-50 transition-colors">
                      <td className="px-4 py-3 align-top">
                        <div className="font-medium text-gray-800">{m.label}</div>
                        {m.field && (
                          <div className={`inline-block mt-1 text-[11px] font-mono px-1.5 py-0.5 rounded ${c.badge}`}>
                            {m.field}
                          </div>
                        )}
                      </td>
                      <td className="px-4 py-3 text-gray-600 align-top">{m.formula}</td>
                      <td className="px-4 py-3 text-gray-400 text-xs align-top">{m.note ?? ''}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )
      })}

      {/* Маппинг колонок */}
      <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
        <div className="px-4 py-3 border-b border-gray-100 bg-gray-50">
          <h2 className="text-sm font-bold text-gray-600 uppercase tracking-wide">Маппинг колонок Excel</h2>
        </div>
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-gray-100">
              <th className="px-4 py-2.5 text-left text-xs font-semibold text-gray-500 uppercase tracking-wide w-16">Кол.</th>
              <th className="px-4 py-2.5 text-left text-xs font-semibold text-gray-500 uppercase tracking-wide">Имя поля</th>
              <th className="px-4 py-2.5 text-left text-xs font-semibold text-gray-500 uppercase tracking-wide">Описание</th>
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
              <tr key={field} className="border-t border-gray-100 hover:bg-gray-50 transition-colors">
                <td className="px-4 py-2.5 font-mono font-bold text-gray-400 text-center">{col}</td>
                <td className="px-4 py-2.5 font-mono text-gray-800">{field}</td>
                <td className="px-4 py-2.5 text-gray-600">{desc}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Null */}
      <div className="bg-amber-50 border border-amber-200 rounded-xl p-4 text-sm text-amber-800">
        <strong>Обработка пустых значений:</strong> значение{' '}
        <code className="bg-amber-100 px-1 rounded">[NULL]</code>, пустая строка или отсутствие значения
        интерпретируются как 0. Деление на ноль отображается как «—».
      </div>

    </div>
  )
}
