#!/usr/bin/env node
/** 2025 ОСАГО+кросс → public/data/bundled-osago-2025.json (поля как upload-main.mjs). */
import * as XLSX from 'xlsx'
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const DEFAULT_IN =
  '/Users/elenaivanova/Downloads/Статусы ЛК Партнера/Лояльность статусы/статистика лояльность. 2025 для дашбордов.xlsx'
const OUT = path.join(__dirname, '..', 'public', 'data', 'bundled-osago-2025.json')

const MAIN_FIELDS = [
  'CreateDate', 'State', 'LoyaltyPointsInLK', 'LoyaltyPointsScoring',
  'CrossIsBought', 'FinalPrice', 'PolicyPrice', 'ChargedToIncreasedKV',
  'RenId', 'Role', 'FullName', 'AgentName', 'CashbookId', 'HeadPartnerCB',
  'AvailableForUsePoints', 'SalesChannel', 'OsagoType',
]

function getHeaderMaxCol(sheet) {
  let maxCol = 0
  for (const key of Object.keys(sheet)) {
    if (key.startsWith('!')) continue
    const { r, c } = XLSX.utils.decode_cell(key)
    if (r !== 0) continue
    const v = sheet[key]?.v
    if (typeof v === 'string' && v.trim() !== '' && Number.isNaN(Number(v))) {
      if (c > maxCol) maxCol = c
    }
  }
  return maxCol > 0 ? maxCol : 35
}

function limitSheetColumns(sheet) {
  const maxCol = getHeaderMaxCol(sheet)
  const limited = { ...sheet }
  for (const key of Object.keys(limited)) {
    if (key.startsWith('!')) continue
    if (XLSX.utils.decode_cell(key).c > maxCol) delete limited[key]
  }
  if (limited['!ref']) {
    const range = XLSX.utils.decode_range(limited['!ref'])
    range.e.c = Math.min(range.e.c, maxCol)
    limited['!ref'] = XLSX.utils.encode_range(range)
  }
  return limited
}

function toIsoDate(v) {
  if (v == null) return null
  if (v instanceof Date) return v.toISOString()
  if (typeof v === 'number') return new Date((v - 25569) * 86400000).toISOString()
  return String(v)
}

function slimRow(r) {
  const obj = {}
  for (const k of MAIN_FIELDS) {
    let val = r[k]
    if (k === 'CreateDate') val = toIsoDate(val)
    obj[k] = val ?? null
  }
  return obj
}

function main() {
  const filePath = process.argv[2] || DEFAULT_IN
  if (!fs.existsSync(filePath)) {
    console.error('File not found:', filePath)
    process.exit(1)
  }
  const wb = XLSX.read(fs.readFileSync(filePath), { type: 'buffer', cellDates: true })
  const all = []
  for (const name of wb.SheetNames) {
    const sheet = limitSheetColumns(wb.Sheets[name])
    const rows = XLSX.utils.sheet_to_json(sheet, { defval: null, raw: false })
    for (const r of rows) {
      if (!r || !r.State) continue
      all.push(slimRow(r))
    }
    console.log(name, '→', rows.length)
  }
  fs.mkdirSync(path.dirname(OUT), { recursive: true })
  fs.writeFileSync(OUT, JSON.stringify(all))
  console.log('Wrote', all.length, 'rows →', OUT, `(${(fs.statSync(OUT).size / 1e6).toFixed(1)} MB)`)
}

main()