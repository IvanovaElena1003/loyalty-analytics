# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
npm run dev          # dev server on :5174 (see .claude/launch.json)
npm run build        # tsc -b && vite build  — always run before committing
npm run lint         # eslint
npm run preview      # serve dist/ locally
npx vercel --prod    # deploy to production (linked project: sz-dashboard/loyalty-analytics)
```

No tests exist in this project. `npm run build` is the only verification gate — it runs the TypeScript compiler in strict mode before bundling.

## Architecture

**Pure client-side SPA.** No backend, no routing. The user uploads an `.xlsx` file; all computation happens in the browser via the `xlsx` library.

### Data flow

```
UploadTab (file drop)
  → parseWorkbook()          reads all sheets, returns RawRow[]
  → aggregate(rows)          returns AggregateResult
  → App.tsx state
  → tabs receive either result or result.rawRows
```

`AggregateResult` is the central shared type. It holds:
- `months: MonthMetrics[]` — per-month aggregated metrics
- `totals: MonthMetrics` — pre-summed across all months
- `accrualValues / spendingValues` — flat arrays of individual values for distribution histograms
- `rawRows: RawRow[]` — full unfiltered row array passed to Аномалии and Вовлечённость tabs

### Two computation layers

**`src/utils/aggregate.ts`** — month-level aggregation. Runs once on upload. Uses **local timezone** for date bucketing (`date.getMonth()` etc). `EXCLUDED_STATES = {PolicyAnnulled, PolicyTerminated}` are filtered from all counts. `BASE_PRICE = 2490` is the default Кросс-Каско price when `PolicyPrice` is absent.

**`src/utils/engagement.ts`** — agent-level analysis computed lazily in `EngagementTab` via `useMemo`. Uses **UTC** (`getUTCMonth()`, `Date.UTC`) for all date math to avoid DST shifts in cohort windows. Groups by `RenId`, not `FullName`. Exports typed compute functions (`computeSection1/2/3`) and a shared `downloadXlsx` utility.

**`AnomaliesTab.tsx`** does its own local computations in `useMemo` from `rawRows` — no separate util file.

### Tab registry

Tabs are declared in `App.tsx` as `TABS` array with `needsData?: true`. Adding a new tab = add entry there + new `{!loading && tab === 'x' && result && <XTab ... />}` line.

## Key business rules

**Null handling.** `isNull(v)` treats `null`, `undefined`, `""`, and `"[NULL]"` as missing. `toNumber` returns `0` for missing values. Always use these helpers, not raw `== null` checks.

**Bonus presence.** A row "has bonus" when `LoyaltyPointsInLK > 0` (not null, not zero). The `hasBonus` helper in `engagement.ts` is the canonical implementation; `aggregate.ts` has an equivalent inline.

**Accrual rule.** Count/sum only rows where `State = "PolicyIssued"` AND `LoyaltyPointsInLK > 0`.

**Spending rules — independent conditions.** A single row can be counted in BOTH categories simultaneously:
- **Discount**: `CrossIsBought = "Да"` AND `FinalPrice ≠ PolicyPrice` (default 2490). Amount = `PolicyPrice − FinalPrice`.
- **Increased KV**: `CrossIsBought = "Да"` AND `ChargedToIncreasedKV ≠ 0`. Amount = `ChargedToIncreasedKV` value verbatim.
- **Base** (no spending): `FinalPrice = PolicyPrice` AND `ChargedToIncreasedKV = 0`.

**LoyaltyPointsScoring anomaly.** Expected invariant (from 2026-03-01): `LoyaltyPointsInLK = floor(LoyaltyPointsScoring)`. Rows where `|InLK − floor(Scoring)| > 0.5` are flagged.

**Excel serial dates.** `CreateDate` arrives as an Excel serial number (`number`), a `Date` object (when `xlsx` is given `cellDates: true`), or occasionally a string. Both `aggregate.ts` and `engagement.ts` handle all three forms. `aggregate.ts` uses `new Date((serial − 25569) * 86400000)` with local timezone; `engagement.ts` uses the same formula but then reads UTC components.

## Formatting conventions

All numbers: `n.toLocaleString('ru-RU')`. Percentages: one decimal place + `%`. Division by zero → `"—"`. Monetary deltas shown with `+`/`−` prefix and coloured green/red.

## Column names from Excel (key fields)

| Field | Excel column | Notes |
|---|---|---|
| `CreateDate` | I | Excel serial or Date |
| `State` | J | PolicyIssued / Refused / PolicyAnnulled / PolicyTerminated |
| `LoyaltyPointsInLK` | T | Current bonus balance in agent's LK account |
| `LoyaltyPointsScoring` | — | Same value with fractional part; InLK = floor(Scoring) |
| `CrossIsBought` | AF | `"Да"` / `"Нет"` |
| `FinalPrice` | AG | Cross-kasko price; base = 2490 |
| `ChargedToIncreasedKV` | AH | Amount charged to increased KV; null/0 if not used |
| `RenId` | — | Unique agent identifier (group by this, not FullName) |
| `FullName` | — | Agent name (may vary across rows for same RenId) |
| `Role` | — | Agent role for Section 1 of Вовлечённость |
| `QuotationNumber` | — | Quote identifier used in Аномалии drill-down |

`RawRow` uses `[key: string]: unknown` index signature so any column is accessible without adding to the interface — only add typed fields when the column is used in typed logic.
