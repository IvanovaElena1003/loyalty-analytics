#!/usr/bin/env python3
"""Сводка для вкладки «Для статусов» → src/data/statusesSnapshot.ts (только числа, без сырья в git)."""

from __future__ import annotations

import json
from collections import defaultdict
from dataclasses import dataclass, field
from datetime import datetime
from pathlib import Path

import openpyxl
import pandas as pd

ROOT = Path(__file__).resolve().parents[1]
OUT_TS = ROOT / "src" / "data" / "statusesSnapshot.ts"

PATH_OSAGO_2025 = Path(
    "/Users/elenaivanova/Downloads/Статусы ЛК Партнера/Лояльность статусы/"
    "статистика лояльность. 2025 для дашбордов.xlsx"
)
PATH_OSAGO_2026 = Path(
    "/Users/elenaivanova/Downloads/Статусы ЛК Партнера/Лояльность статусы/"
    "статистика лояльность. 2026 для дашбордов.xlsx"
)
PATH_KASKO = Path(
    "/Users/elenaivanova/Downloads/Статусы ЛК Партнера/Каско ФК17/"
    "Каско котировки лояльность 01.08-18.11.xlsx"
)
PATH_SLIDER = Path("/Users/elenaivanova/Downloads/Списание рен-бонусов ползунок_ОСАГО.xlsx")
PATH_AGENTS = Path(
    "/Users/elenaivanova/Downloads/Базы партнеров/"
    "База партенров В2Partners от 08.06 за 2026 год\u00a0— усеченная.xlsx"
)

START = datetime(2025, 7, 30)
END = datetime(2026, 11, 18, 23, 59, 59)
OSAGO_SLIDER_LAUNCH = "2026-06-08"
EXCLUDED = frozenset({"PolicyAnnulled", "PolicyTerminated"})
BASE_PRICE = 2490
ISSUED = "PolicyIssued"
SELLER_ROLES = frozenset({"Seller", "Продавец"})


def is_null(v) -> bool:
    if v is None:
        return True
    if isinstance(v, str) and v.strip().upper() in ("[NULL]", "NULL", "NONE", ""):
        return True
    return False


def to_num(v) -> float:
    if is_null(v):
        return 0.0
    if isinstance(v, (int, float)):
        return float(v)
    if isinstance(v, str):
        s = v.replace(" ", "").replace(",", ".")
        try:
            return float(s)
        except ValueError:
            return 0.0
    return 0.0


def parse_dt(v) -> datetime | None:
    if v is None:
        return None
    if isinstance(v, datetime):
        return v
    if isinstance(v, (int, float)):
        from datetime import timedelta

        return datetime(1899, 12, 30) + timedelta(days=float(v))
    if isinstance(v, str):
        for fmt in ("%Y-%m-%d %H:%M:%S", "%Y-%m-%d", "%d.%m.%Y %H:%M", "%d.%m.%Y", "%m/%d/%y %H:%M"):
            try:
                return datetime.strptime(v.strip(), fmt)
            except ValueError:
                continue
    return None


def in_window(dt: datetime) -> bool:
    return START <= dt <= END


def header_map(row_values: tuple) -> dict[str, int]:
    return {str(k).strip(): i for i, k in enumerate(row_values) if k is not None and str(k).strip()}


def cell(row: tuple, idx: dict[str, int], name: str):
    i = idx.get(name)
    if i is None or i >= len(row):
        return None
    return row[i]


def wallet_key(row: tuple, idx: dict[str, int]) -> str:
    role = str(cell(row, idx, "Role") or "").strip()
    if role in SELLER_ROLES:
        return ""
    hcb = cell(row, idx, "HeadPartnerCB")
    if not is_null(hcb):
        return str(hcb).strip()
    cb = cell(row, idx, "CashbookId")
    if is_null(cb):
        return ""
    return str(cb).strip()


@dataclass
class Totals:
    acc_osago: float = 0.0
    acc_kasko: float = 0.0
    spend_cross_discount: float = 0.0
    spend_cross_kv: float = 0.0
    spend_kasko: float = 0.0
    spend_osago_slider: float = 0.0
    cross_discount_cnt: int = 0
    cross_kv_cnt: int = 0
    kasko_spend_cnt: int = 0
    osago_slider_cnt: int = 0

    @property
    def acc_total(self) -> float:
        return self.acc_osago + self.acc_kasko

    @property
    def spend_total(self) -> float:
        return (
            self.spend_cross_discount
            + self.spend_cross_kv
            + self.spend_kasko
            + self.spend_osago_slider
        )

    def util_pct(self) -> float | None:
        if self.acc_total <= 0:
            return None
        return self.spend_total / self.acc_total * 100

    def to_dict(self) -> dict:
        return {
            "accOsago": round(self.acc_osago),
            "accKasko": round(self.acc_kasko),
            "accTotal": round(self.acc_total),
            "spendCrossDiscount": round(self.spend_cross_discount),
            "spendCrossKv": round(self.spend_cross_kv),
            "spendKasko": round(self.spend_kasko),
            "spendOsagoSlider": round(self.spend_osago_slider),
            "spendTotal": round(self.spend_total),
            "utilPct": round(self.util_pct(), 2) if self.util_pct() is not None else None,
            "crossDiscountCnt": self.cross_discount_cnt,
            "crossKvCnt": self.cross_kv_cnt,
            "kaskoSpendCnt": self.kasko_spend_cnt,
            "osagoSliderCnt": self.osago_slider_cnt,
        }


def load_filial_map() -> dict[str, str]:
    if not PATH_AGENTS.exists():
        return {}
    try:
        df = pd.read_excel(PATH_AGENTS, sheet_name=0, header=0)
    except Exception:
        return {}
    m: dict[str, str] = {}
    for _, r in df.iterrows():
        sid = r.get("subj_id")
        if pd.isna(sid):
            continue
        cb = str(int(sid)) if isinstance(sid, float) and sid == int(sid) else str(sid).strip()
        fil = r.get("ФИЛИАЛ")
        if pd.isna(fil):
            fil = r.get("Филиал")
        if pd.isna(fil):
            continue
        m[cb] = str(fil).strip()
    return m


def filial_for(cb: str, fmap: dict[str, str]) -> str:
    if not cb:
        return "Без филиала"
    return fmap.get(cb, "Без филиала")


def process_osago_workbook(
    path: Path,
    total: Totals,
    by_filial: dict[str, Totals],
    starts: dict[str, datetime | None],
    fmap: dict[str, str],
    rows_counter: list[int],
) -> tuple[datetime | None, datetime | None]:
    if not path.exists():
        return None, None
    wb = openpyxl.load_workbook(path, read_only=True, data_only=True)
    dmin = dmax = None
    for sheet_name in wb.sheetnames:
        sh = wb[sheet_name]
        it = sh.iter_rows(values_only=True)
        try:
            header = next(it)
        except StopIteration:
            continue
        idx = header_map(header)
        for row in it:
            if not row:
                continue
            rows_counter[0] += 1
            wk = wallet_key(row, idx)
            if not wk and str(cell(row, idx, "Role") or "").strip() in SELLER_ROLES:
                continue
            state = str(cell(row, idx, "State") or "")
            if state in EXCLUDED:
                continue
            dt = parse_dt(cell(row, idx, "CreateDate"))
            if dt is None:
                continue
            dmin = dt if dmin is None or dt < dmin else dmin
            dmax = dt if dmax is None or dt > dmax else dmax
            if state != ISSUED or not in_window(dt):
                continue
            reg = filial_for(wk or str(cell(row, idx, "CashbookId") or ""), fmap)
            bf = by_filial[reg]

            lp = to_num(cell(row, idx, "LoyaltyPointsInLK"))
            if not is_null(cell(row, idx, "LoyaltyPointsInLK")) and lp > 0:
                total.acc_osago += lp
                bf.acc_osago += lp
                starts["accOsago"] = min(starts.get("accOsago") or dt, dt)

            if str(cell(row, idx, "CrossIsBought") or "").strip() != "Да":
                continue
            pp_raw = cell(row, idx, "PolicyPrice")
            pp = to_num(pp_raw) if not is_null(pp_raw) else BASE_PRICE
            fp = to_num(cell(row, idx, "FinalPrice"))
            if not is_null(cell(row, idx, "FinalPrice")) and fp != pp:
                disc = pp - fp
                if disc > 0:
                    total.spend_cross_discount += disc
                    bf.spend_cross_discount += disc
                    total.cross_discount_cnt += 1
                    bf.cross_discount_cnt += 1
                    starts["spendCrossDiscount"] = min(starts.get("spendCrossDiscount") or dt, dt)
            kv = to_num(cell(row, idx, "ChargedToIncreasedKV"))
            if not is_null(cell(row, idx, "ChargedToIncreasedKV")) and kv != 0:
                total.spend_cross_kv += abs(kv)
                bf.spend_cross_kv += abs(kv)
                total.cross_kv_cnt += 1
                bf.cross_kv_cnt += 1
                starts["spendCrossKv"] = min(starts.get("spendCrossKv") or dt, dt)
    wb.close()
    return dmin, dmax


def process_kasko(
    path: Path,
    total: Totals,
    by_filial: dict[str, Totals],
    starts: dict[str, datetime | None],
    fmap: dict[str, str],
    rows_counter: list[int],
) -> tuple[datetime | None, datetime | None]:
    if not path.exists():
        return None, None
    wb = openpyxl.load_workbook(path, read_only=True, data_only=True)
    sh = wb[wb.sheetnames[0]]
    it = sh.iter_rows(values_only=True)
    header = next(it)
    idx = header_map(header)
    dmin = dmax = None
    for row in it:
        if not row:
            continue
        rows_counter[0] += 1
        role = str(cell(row, idx, "Role") or "")
        if role in SELLER_ROLES:
            continue
        state = str(cell(row, idx, "State") or "")
        if state in EXCLUDED:
            continue
        dt = parse_dt(cell(row, idx, "CreateDate"))
        if dt is None:
            continue
        dmin = dt if dmin is None or dt < dmin else dmin
        dmax = dt if dmax is None or dt > dmax else dmax
        if state != ISSUED or not in_window(dt):
            continue
        cb = wallet_key(row, idx) or str(cell(row, idx, "CashbookId") or "").strip()
        reg = filial_for(cb, fmap)
        bf = by_filial[reg]
        lpo = to_num(cell(row, idx, "LoyaltyPointsOut"))
        ov = to_num(cell(row, idx, "OriginalValue"))
        if lpo > 0 and ov > 0:
            acc = ov * lpo
            total.acc_kasko += acc
            bf.acc_kasko += acc
            starts["accKasko"] = min(starts.get("accKasko") or dt, dt)
        spend = to_num(cell(row, idx, "WalletBonuses")) + to_num(cell(row, idx, "ScoringBonuses"))
        if spend > 0:
            total.spend_kasko += spend
            bf.spend_kasko += spend
            total.kasko_spend_cnt += 1
            bf.kasko_spend_cnt += 1
            starts["spendKasko"] = min(starts.get("spendKasko") or dt, dt)
    wb.close()
    return dmin, dmax


def process_slider(
    path: Path,
    total: Totals,
    by_filial: dict[str, Totals],
    fmap: dict[str, str],
) -> str:
    if not path.exists():
        return "—"
    qt = pd.read_excel(path, sheet_name="Котировки", header=0)
    qt["dt"] = pd.to_datetime(qt.get("Дата и время"), errors="coerce")
    if qt["dt"].isna().all():
        qt["dt"] = pd.to_datetime(qt.get("Дата оформления"), errors="coerce")
    for _, r in qt.iterrows():
        dt = r["dt"]
        if pd.isna(dt):
            continue
        dt_py = dt.to_pydatetime() if hasattr(dt, "to_pydatetime") else dt
        if not in_window(dt_py):
            continue
        spend = to_num(r.get("Списано ренбонусов"))
        if spend <= 0:
            continue
        total.spend_osago_slider += spend
        total.osago_slider_cnt += 1
        # без CashbookId в котировках — в филиалы не режем списание ползунка

    if PATH_AGENTS.exists() and path.exists():
        try:
            ag = pd.read_excel(path, sheet_name="Агенты", header=0)
            for _, r in ag.iterrows():
                cb_raw = r.get("Кэшбук")
                if pd.isna(cb_raw):
                    continue
                cb = str(int(cb_raw)) if isinstance(cb_raw, float) and cb_raw == int(cb_raw) else str(cb_raw).strip()
                spend = to_num(r.get("Списано ренбонусов"))
                if spend <= 0:
                    continue
                reg = filial_for(cb, fmap)
                # только для разреза; итог total уже из котировок в окне
                by_filial[reg].spend_osago_slider += spend
                by_filial[reg].osago_slider_cnt += int(to_num(r.get("Число полисов")))
        except Exception:
            pass

    dmin, dmax = qt["dt"].min(), qt["dt"].max()
    if pd.isna(dmin):
        return "—"
    return f"{pd.Timestamp(dmin):%d.%m.%Y} – {pd.Timestamp(dmax):%d.%m.%Y}"


def fmt_iso(d: datetime | None) -> str | None:
    if d is None:
        return None
    return d.strftime("%Y-%m-%d")


def merge_totals(dst: Totals, src: Totals) -> None:
    dst.acc_osago += src.acc_osago
    dst.acc_kasko += src.acc_kasko
    dst.spend_cross_discount += src.spend_cross_discount
    dst.spend_cross_kv += src.spend_cross_kv
    dst.spend_kasko += src.spend_kasko
    dst.spend_osago_slider += src.spend_osago_slider
    dst.cross_discount_cnt += src.cross_discount_cnt
    dst.cross_kv_cnt += src.cross_kv_cnt
    dst.kasko_spend_cnt += src.kasko_spend_cnt
    dst.osago_slider_cnt += src.osago_slider_cnt


def rollup_top3(by_filial: dict[str, Totals]) -> list[dict]:
    def is_moscow(n: str) -> bool:
        return "москв" in n.lower()

    def is_spb(n: str) -> bool:
        return "петербург" in n.lower()

    m, s, reg = Totals(), Totals(), Totals()
    children: list[dict] = []
    for name, b in by_filial.items():
        if b.acc_total <= 0 and b.spend_total <= 0:
            continue
        row = {"region": name, **b.to_dict()}
        if is_moscow(name):
            merge_totals(m, b)
        elif is_spb(name):
            merge_totals(s, b)
        else:
            children.append(row)
            merge_totals(reg, b)

    out: list[dict] = []
    if m.acc_total or m.spend_total:
        out.append({"region": "Москва", "rollup": "moscow", **m.to_dict()})
    if s.acc_total or s.spend_total:
        out.append({"region": "Санкт-Петербург", "rollup": "spb", **s.to_dict()})
    if children:
        out.append(
            {
                "region": "Регионы",
                "rollup": "regions",
                "children": sorted(children, key=lambda x: x["spendTotal"], reverse=True),
                **reg.to_dict(),
            }
        )
    return out


def main() -> None:
    fmap = load_filial_map()
    total = Totals()
    by_filial: dict[str, Totals] = defaultdict(Totals)
    starts: dict[str, datetime | None] = {}
    osago_rows = [0]
    kasko_rows = [0]

    o25 = process_osago_workbook(PATH_OSAGO_2025, total, by_filial, starts, fmap, osago_rows)
    o26 = process_osago_workbook(PATH_OSAGO_2026, total, by_filial, starts, fmap, osago_rows)
    krng = process_kasko(PATH_KASKO, total, by_filial, starts, fmap, kasko_rows)
    slider_range = process_slider(PATH_SLIDER, total, by_filial, fmap)

    starts["spendOsagoSlider"] = datetime(2026, 6, 8)

    by_region = [
        {"region": k, **v.to_dict()}
        for k, v in sorted(by_filial.items(), key=lambda x: x[1].spend_total, reverse=True)
        if v.acc_total > 0 or v.spend_total > 0
    ]

    snapshot = {
        "generatedAt": datetime.now().strftime("%Y-%m-%d"),
        "periodLabel": "30.07.2025 – 18.11.2026",
        "agentFilialMapSize": len(fmap),
        "meta": {
            "rowsOsagoAllStatuses": osago_rows[0],
            "rowsKaskoAllStatuses": kasko_rows[0],
            "osago2025Note": "лист окт.2025 в xlsx пустой",
            "sliderDataRange": slider_range,
        },
        "totals": total.to_dict(),
        "mechanicStarts": {
            "accOsago": fmt_iso(starts.get("accOsago")),
            "accKasko": fmt_iso(starts.get("accKasko")),
            "spendCrossDiscount": fmt_iso(starts.get("spendCrossDiscount")),
            "spendCrossKv": fmt_iso(starts.get("spendCrossKv")),
            "spendKasko": fmt_iso(starts.get("spendKasko")),
            "spendOsagoSlider": OSAGO_SLIDER_LAUNCH,
        },
        "byRegion": by_region,
        "top3": rollup_top3(by_filial),
    }

    payload = json.dumps(snapshot, ensure_ascii=False, indent=2)
    ts = f"""// AUTO-GENERATED by scripts/build_statuses_snapshot.py — не править вручную
export const STATUSES_SNAPSHOT = {payload} as const
export type StatusesSnapshot = typeof STATUSES_SNAPSHOT
"""
    OUT_TS.write_text(ts, encoding="utf-8")
    print("Written", OUT_TS)
    print("totals", total.to_dict())


if __name__ == "__main__":
    main()