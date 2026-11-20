#!/usr/bin/env node
/**
 * KASKO + ползунок ОСАГО → Supabase (kasko_rows.json.gz, slider_quotes.json.gz).
 * CashbookId на котировках ползунка — джойн по номеру полиса к выгрузке статистики ОСАГО.
 */
import * as XLSX from 'xlsx'
import { createClient } from '@supabase/supabase-js'
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'
import zlib from 'zlib'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const BUCKET = 'loyalty-data'

const PATH_OSAGO =
  process.argv[2] ||
  '/Users/elenaivanova/Downloads/Статусы ЛК Партнера/Лояльность статусы/статистика лояльность. 2026 для дашбордов.xlsx'
const PATH_KASKO =
  process.argv[3] ||
  '/Users/elenaivanova/Downloads/Статусы ЛК Партнера/Каско ФК17/Каско котировки лояльность 01.08-18.11.xlsx'
const PATH_SLIDER =
  process.argv[4] ||
  '/Users/elenaivanova/Downloads/Списание рен-бонусов ползунок_ОСАГО.xlsx'

const KASKO_FIELDS = [
  'CreateDate', 'State', 'Role', 'CashbookId', 'HeadPartnerCB',
  'LoyaltyPointsOut', 'OriginalValue', 'WalletBonuses', 'ScoringBonuses',
]

function loadEnvLocal() {
  const envPath = path.join(__dirname, '..', '.env.local')
  if (!fs.existsSync(envPath)) return
  for (const line of fs.readFileSync(envPath, 'utf8').split('\n')) {
    const m = line.match(/^([A-Z_]+)=(.*)$/)
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim()
  }
}

function normPolicy(s) {
  if (s == null) return ''
  return String(s).replace(/\s+/g, '').toUpperCase()
}

function toNum(v) {
  if (v == null || v === '' || v === '[NULL]') return 0
  const n = Number(v)
  return Number.isNaN(n) ? 0 : n
}

function slimKasko(rows) {
  return rows
    .filter(r => String(r.Role ?? '') !== 'Seller')
    .map(r => {
      const o = {}
      for (const k of KASKO_FIELDS) o[k] = r[k] ?? null
      return o
    })
}

function readWorkbook(filePath) {
  const buf = fs.readFileSync(filePath)
  return XLSX.read(buf, { type: 'buffer', cellDates: true })
}

function buildPolicyToCashbook(osagoPath) {
  const wb = readWorkbook(osagoPath)
  const map = new Map()
  for (const name of wb.SheetNames) {
    const rows = XLSX.utils.sheet_to_json(wb.Sheets[name], { defval: null })
    for (const r of rows) {
      const pn = normPolicy(r.PolicyNumber)
      const cb = String(r.CashbookId ?? '').trim()
      if (pn && cb) map.set(pn, cb)
    }
  }
  return map
}

function buildSliderQuotes(sliderPath, policyToCb) {
  const wb = readWorkbook(sliderPath)
  const rows = XLSX.utils.sheet_to_json(wb.Sheets['Котировки'], { defval: null })
  const out = []
  let linked = 0
  for (const r of rows) {
    const spend = toNum(r['Списано ренбонусов'])
    if (spend <= 0) continue
    const pn = normPolicy(r['Серия и номер полиса'])
    const cb = policyToCb.get(pn) ?? null
    if (cb) linked++
    const dt = r['Дата и время'] ?? r['Дата оформления']
    out.push({
      PolicyNumber: r['Серия и номер полиса'] ?? null,
      CreateDate: dt,
      spend,
      CashbookId: cb,
    })
  }
  console.log(`Slider quotes: ${out.length}, with CashbookId: ${linked} (${((linked / out.length) * 100).toFixed(1)}%)`)
  return out
}

async function upload(name, data) {
  const url = process.env.VITE_SUPABASE_URL
  const key = process.env.VITE_SUPABASE_ANON_KEY
  if (!url || !key) throw new Error('Need VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY in .env.local')
  const sb = createClient(url, key)
  const gz = zlib.gzipSync(Buffer.from(JSON.stringify(data)))
  const { error } = await sb.storage.from(BUCKET).upload(name, gz, {
    upsert: true,
    contentType: 'application/gzip',
  })
  if (error) throw error
  console.log('Uploaded', name, `${(gz.length / 1024 / 1024).toFixed(2)} MB gzip`)
}

async function main() {
  loadEnvLocal()
  const policyToCb = buildPolicyToCashbook(PATH_OSAGO)
  console.log('Policy→Cashbook keys:', policyToCb.size)

  const kaskoWb = readWorkbook(PATH_KASKO)
  const kaskoSheet = kaskoWb.Sheets[kaskoWb.SheetNames[0]]
  const kaskoRows = slimKasko(XLSX.utils.sheet_to_json(kaskoSheet, { defval: null }))
  console.log('KASKO rows:', kaskoRows.length)

  const sliderQuotes = buildSliderQuotes(PATH_SLIDER, policyToCb)

  await upload('kasko_rows.json.gz', kaskoRows)
  await upload('slider_quotes.json.gz', sliderQuotes)
}

main().catch(e => {
  console.error(e)
  process.exit(1)
})