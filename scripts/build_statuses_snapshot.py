#!/usr/bin/env python3
"""Сводка для вкладки «Для статусов» → src/data/statusesSnapshot.ts (только числа, без сырья в git)."""

from __future__ import annotations

import json
from collections import defaultdict
from dataclasses import dataclass, field
from datetime import datetime, timedelta
from pathlib import Path
from statistics import median

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
MIN_OSAGO_ACTIVE = 3


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


@dataclass
class WalletAgg:
    osago_issued: int = 0
    kasko_issued: int = 0
    cross: int = 0
    spend_events: int = 0
    cross_spend_events: int = 0
    has_accrual: bool = False

    @property
    def has_issued(self) -> bool:
        return self.osago_issued > 0 or self.kasko_issued > 0


def is_cross_spend_row(row: tuple, idx: dict[str, int]) -> bool:
    if str(cell(row, idx, "CrossIsBought") or "").strip() != "Да":
        return False
    pp_raw = cell(row, idx, "PolicyPrice")
    pp = to_num(pp_raw) if not is_null(pp_raw) else BASE_PRICE
    fp = to_num(cell(row, idx, "FinalPrice"))
    kv = to_num(cell(row, idx, "ChargedToIncreasedKV"))
    if not is_null(cell(row, idx, "ChargedToIncreasedKV")) and kv != 0:
        return True
    if not is_null(cell(row, idx, "FinalPrice")) and fp != pp:
        return True
    return False


def ym_str(dt: datetime) -> str:
    return f"{dt.year}-{dt.month:02d}"


def month_range(ym: str) -> tuple[datetime, datetime]:
    y, mo = map(int, ym.split("-"))
    start = datetime(y, mo, 1)
    if mo == 12:
        end = datetime(y + 1, 1, 1) - timedelta(seconds=1)
    else:
        end = datetime(y, mo + 1, 1) - timedelta(seconds=1)
    return start, end


def fmt_period_label(start: datetime, end: datetime) -> str:
    return f"{start.strftime('%d.%m.%Y')} – {end.strftime('%d.%m.%Y')}"


def trailing_window_start(end: datetime, months: int) -> datetime:
    """Скользящее окно [start … end], календарные месяцы (день+1 после «-N мес»)."""
    y, m, d = end.year, end.month, end.day
    m -= months
    while m <= 0:
        m += 12
        y -= 1
    _, last_in_month = month_range(f"{y}-{m:02d}")
    day = min(d, last_in_month.day)
    anchor = datetime(y, m, day)
    start = anchor + timedelta(days=1)
    start = start.replace(hour=0, minute=0, second=0, microsecond=0)
    return max(start, START)


def partners_in_date_range(
    month_map: dict[str, set[str]],
    range_start: datetime,
    range_end: datetime,
) -> set[str]:
    out: set[str] = set()
    for ym, members in month_map.items():
        m_start, m_end = month_range(ym)
        if m_end < range_start or m_start > range_end:
            continue
        out |= members
    return out


def spend_mechanic_breakdown_sets(
    cross: set[str],
    kasko: set[str],
    slider: set[str],
    accrual_n: int,
    spend_n: int,
) -> dict:
    def row(partners: set[str]) -> dict:
        n = len(partners)
        return {
            "partners": n,
            "pctOfAccrualBase": round(n / accrual_n * 100, 1) if accrual_n else None,
            "pctOfSpenders": round(n / spend_n * 100, 1) if spend_n else None,
        }

    return {
        "cross": row(cross),
        "kasko": row(kasko),
        "osagoSlider": row(slider),
        "noteMutual": "Механики не взаимоисключающие: один партнёр может попасть в несколько строк.",
    }


def spend_mechanic_breakdown(
    month_cross: dict[str, set[str]],
    month_kasko: dict[str, set[str]],
    month_slider: dict[str, set[str]],
    range_start: datetime,
    range_end: datetime,
    accrual_n: int,
    spend_n: int,
) -> dict:
    return spend_mechanic_breakdown_sets(
        partners_in_date_range(month_cross, range_start, range_end),
        partners_in_date_range(month_kasko, range_start, range_end),
        partners_in_date_range(month_slider, range_start, range_end),
        accrual_n,
        spend_n,
    )


def filter_by_top3(partners: set[str], region: str | None, fmap: dict[str, str]) -> set[str]:
    if region is None:
        return {cb for cb in partners if cb}
    return {cb for cb in partners if cb and wallet_top3_region(cb, fmap) == region}


def partner_window_slice(
    region: str | None,
    fmap: dict[str, str],
    month_issued: dict[str, set[str]],
    month_accrual: dict[str, set[str]],
    month_spend: dict[str, set[str]],
    month_cross: dict[str, set[str]],
    month_kasko: dict[str, set[str]],
    month_slider: dict[str, set[str]],
    range_start: datetime,
    range_end: datetime,
    period_label: str,
) -> dict:
    issued = filter_by_top3(partners_in_date_range(month_issued, range_start, range_end), region, fmap)
    accrual = filter_by_top3(partners_in_date_range(month_accrual, range_start, range_end), region, fmap)
    spend = filter_by_top3(partners_in_date_range(month_spend, range_start, range_end), region, fmap)
    cross = filter_by_top3(partners_in_date_range(month_cross, range_start, range_end), region, fmap)
    kasko = filter_by_top3(partners_in_date_range(month_kasko, range_start, range_end), region, fmap)
    slider = filter_by_top3(partners_in_date_range(month_slider, range_start, range_end), region, fmap)
    mech = spend_mechanic_breakdown_sets(cross, kasko, slider, len(accrual), len(spend))
    out = partner_period_slice(issued, accrual, spend, period_label, mech)
    out["region"] = "Вся сеть" if region is None else region
    return out


def partner_metrics_by_top3(
    fmap: dict[str, str],
    month_issued: dict[str, set[str]],
    month_accrual: dict[str, set[str]],
    month_spend: dict[str, set[str]],
    month_cross: dict[str, set[str]],
    month_kasko: dict[str, set[str]],
    month_slider: dict[str, set[str]],
    range_start: datetime,
    range_end: datetime,
    period_label: str,
) -> list[dict]:
    return [
        partner_window_slice(
            region,
            fmap,
            month_issued,
            month_accrual,
            month_spend,
            month_cross,
            month_kasko,
            month_slider,
            range_start,
            range_end,
            period_label,
        )
        for region in (None, *TOP3_LABELS)
    ]


def partner_period_slice(
    issued: set[str],
    accrual: set[str],
    spend: set[str],
    period_label: str,
    spend_by_mechanic: dict | None = None,
) -> dict:
    out = {
        "periodLabel": period_label,
        "accrualPartners": len(accrual),
        "issuedPartners": len(issued),
        "accrualSharePct": round(len(accrual) / len(issued) * 100, 1) if issued else None,
        "spendPartners": len(spend),
        "accrualBaseForSpend": len(accrual),
        "spendSharePct": round(len(spend) / len(accrual) * 100, 1) if accrual else None,
    }
    if spend_by_mechanic is not None:
        out["spendByMechanic"] = spend_by_mechanic
    return out


def partner_slice_with_mechanics(
    issued: set[str],
    accrual: set[str],
    spend: set[str],
    period_label: str,
    month_cross: dict[str, set[str]],
    month_kasko: dict[str, set[str]],
    month_slider: dict[str, set[str]],
    range_start: datetime,
    range_end: datetime,
) -> dict:
    mech = spend_mechanic_breakdown(
        month_cross,
        month_kasko,
        month_slider,
        range_start,
        range_end,
        len(accrual),
        len(spend),
    )
    return partner_period_slice(issued, accrual, spend, period_label, mech)


def last_complete_months(ref: datetime, n: int) -> list[str]:
    out: list[str] = []
    y, m = ref.year, ref.month
    for _ in range(n):
        m -= 1
        if m <= 0:
            m += 12
            y -= 1
        out.append(f"{y}-{m:02d}")
    return list(reversed(out))


TOP3_LABELS = ("Москва", "Санкт-Петербург", "Регионы")
REGION_SLICES = ("Вся сеть", *TOP3_LABELS)


@dataclass
class MechanicNthAgg:
    osago_issued: int = 0
    cross_rb: int = 0
    kasko_issued: int = 0
    kasko_spend: int = 0
    slider_policies: int = 0


def new_regional_nth() -> dict[str, MechanicNthAgg]:
    return {label: MechanicNthAgg() for label in REGION_SLICES}


def regions_for_wallet(cb: str, fmap: dict[str, str]) -> tuple[str, ...]:
    if not cb:
        return ("Вся сеть", "Регионы")
    top3 = wallet_top3_region(cb, fmap)
    return ("Вся сеть", top3)


def every_nth_client(numerator: int, denominator: int) -> int | None:
    if denominator <= 0 or numerator <= 0:
        return None
    return max(1, round(numerator / denominator))


def mechanic_nth_payload(agg: MechanicNthAgg) -> dict:
    return {
        "cross": {
            "events": agg.cross_rb,
            "baseIssuedOsago": agg.osago_issued,
            "everyNthClient": every_nth_client(agg.osago_issued, agg.cross_rb),
        },
        "osagoSlider": {
            "events": agg.slider_policies,
            "baseIssuedOsago": agg.osago_issued,
            "everyNthClient": every_nth_client(agg.osago_issued, agg.slider_policies),
        },
        "kaskoFl": {
            "events": agg.kasko_spend,
            "baseIssuedKasko": agg.kasko_issued,
            "everyNthClient": every_nth_client(agg.kasko_issued, agg.kasko_spend),
        },
    }


def spend_nth_rows(nth_map: dict[str, MechanicNthAgg]) -> list[dict]:
    return [{"region": label, "mechanics": mechanic_nth_payload(nth_map[label])} for label in REGION_SLICES]


def aggregate_slider_top3(by_filial: dict[str, Totals]) -> dict[str, int]:
    out = {label: 0 for label in REGION_SLICES}
    for name, bucket in by_filial.items():
        cnt = bucket.osago_slider_cnt
        if cnt <= 0:
            continue
        out["Вся сеть"] += cnt
        if _is_moscow_filial(name):
            out["Москва"] += cnt
        elif _is_spb_filial(name):
            out["Санкт-Петербург"] += cnt
        else:
            out["Регионы"] += cnt
    return out


def _is_moscow_filial(name: str) -> bool:
    return "москв" in name.lower()


def _is_spb_filial(name: str) -> bool:
    return "петербург" in name.lower()


def wallet_top3_region(cb: str, fmap: dict[str, str]) -> str:
    fil = filial_for(cb, fmap)
    if _is_moscow_filial(fil):
        return "Москва"
    if _is_spb_filial(fil):
        return "Санкт-Петербург"
    return "Регионы"


def compute_partner_engagement(
    wallets: dict[str, WalletAgg],
    fmap: dict[str, str],
    agent_active: set[str],
    region: str | None,
) -> dict:
    """region=None — вся сеть; иначе Москва / Санкт-Петербург / Регионы по филиалу кешбука."""

    def in_slice(cb: str) -> bool:
        if not cb:
            return False
        if region is None:
            return True
        return wallet_top3_region(cb, fmap) == region

    filtered = {cb: wa for cb, wa in wallets.items() if in_slice(cb)}
    accrual = {cb for cb, wa in filtered.items() if wa.has_accrual}
    spend = {cb for cb, wa in filtered.items() if wa.spend_events > 0}
    spend_cross = {cb for cb, wa in filtered.items() if wa.cross_spend_events > 0}
    with_issued = {cb for cb, wa in filtered.items() if wa.has_issued}

    def bucket_nth(pred) -> int | None:
        o = c = 0
        for cb, wa in filtered.items():
            if not wa.has_accrual or not pred(wa.spend_events):
                continue
            o += wa.osago_issued
            c += wa.cross
        if c <= 0:
            return None
        return max(1, round(o / c))

    partners_with_issued = len(with_issued)
    return {
        "pctWithAccrualAmongIssued": round(len(accrual) / partners_with_issued * 100, 1)
        if partners_with_issued
        else None,
        "pctSpendAmongAccrual": round(len(spend) / len(accrual) * 100, 1) if accrual else None,
        "partnersWhoSpendCross": len(spend_cross),
        "pctSpendCrossAmongAccrual": round(len(spend_cross) / len(accrual) * 100, 1) if accrual else None,
        "partnersWithAccrual": len(accrual),
        "partnersWhoSpend": len(spend),
        "partnersWithIssued": partners_with_issued,
        "partnersWithOsago": sum(1 for wa in filtered.values() if wa.osago_issued > 0),
        "buckets": [
            {
                "id": "zero",
                "label": "0 раз списали",
                "partnerCount": sum(1 for wa in filtered.values() if wa.has_accrual and wa.spend_events == 0),
                "everyNthClient": bucket_nth(lambda n: n == 0),
            },
            {
                "id": "mid",
                "label": "3–9 раз списали",
                "partnerCount": sum(
                    1 for wa in filtered.values() if wa.has_accrual and 3 <= wa.spend_events <= 9
                ),
                "everyNthClient": bucket_nth(lambda n: 3 <= n <= 9),
            },
            {
                "id": "high",
                "label": ">10 раз списали",
                "partnerCount": sum(1 for wa in filtered.values() if wa.has_accrual and wa.spend_events >= 10),
                "everyNthClient": bucket_nth(lambda n: n >= 10),
            },
        ],
    }


def _mark_accrual(cb: str, ym: str, month_accrual: dict[str, set[str]], first_acc_ym: dict[str, str]) -> None:
    month_accrual[ym].add(cb)
    if cb not in first_acc_ym or ym < first_acc_ym[cb]:
        first_acc_ym[cb] = ym


def scan_kasko_wallets(
    path: Path,
    wallets: dict[str, WalletAgg],
    month_accrual: dict[str, set[str]],
    month_spend: dict[str, set[str]],
    month_spend_kasko: dict[str, set[str]],
    month_issued: dict[str, set[str]],
    first_acc_ym: dict[str, str],
    nth_full: dict[str, MechanicNthAgg],
    nth_r12: dict[str, MechanicNthAgg],
    nth_r3: dict[str, MechanicNthAgg],
    r12_start: datetime,
    r3_start: datetime,
    fmap: dict[str, str],
) -> None:
    if not path.exists():
        return
    wb = openpyxl.load_workbook(path, read_only=True, data_only=True)
    sh = wb[wb.sheetnames[0]]
    it = sh.iter_rows(values_only=True)
    try:
        header = next(it)
    except StopIteration:
        wb.close()
        return
    idx = header_map(header)
    for row in it:
        if not row:
            continue
        role = str(cell(row, idx, "Role") or "").strip()
        if role in SELLER_ROLES:
            continue
        state = str(cell(row, idx, "State") or "")
        if state in EXCLUDED or state != ISSUED:
            continue
        dt = parse_dt(cell(row, idx, "CreateDate"))
        if dt is None or not in_window(dt):
            continue
        cb = wallet_key(row, idx) or str(cell(row, idx, "CashbookId") or "").strip()
        if not cb:
            continue
        wa = wallets[cb]
        ym = ym_str(dt)
        wa.kasko_issued += 1
        month_issued[ym].add(cb)
        for reg in regions_for_wallet(cb, fmap):
            nth_full[reg].kasko_issued += 1
            if dt >= r12_start:
                nth_r12[reg].kasko_issued += 1
            if dt >= r3_start:
                nth_r3[reg].kasko_issued += 1

        lpo = to_num(cell(row, idx, "LoyaltyPointsOut"))
        ov = to_num(cell(row, idx, "OriginalValue"))
        if lpo > 0 and ov > 0:
            wa.has_accrual = True
            _mark_accrual(cb, ym, month_accrual, first_acc_ym)

        spend = to_num(cell(row, idx, "WalletBonuses")) + to_num(cell(row, idx, "ScoringBonuses"))
        if spend > 0:
            wa.spend_events += 1
            month_spend[ym].add(cb)
            month_spend_kasko[ym].add(cb)
            for reg in regions_for_wallet(cb, fmap):
                nth_full[reg].kasko_spend += 1
                if dt >= r12_start:
                    nth_r12[reg].kasko_spend += 1
                if dt >= r3_start:
                    nth_r3[reg].kasko_spend += 1
    wb.close()


def scan_slider_wallet_spend(
    path: Path,
    wallets: dict[str, WalletAgg],
    month_spend: dict[str, set[str]],
    month_spend_slider: dict[str, set[str]],
    spend_ym: str,
) -> None:
    if not path.exists():
        return
    try:
        ag = pd.read_excel(path, sheet_name="Агенты", header=0)
    except Exception:
        return
    for _, r in ag.iterrows():
        cb_raw = r.get("Кэшбук")
        if pd.isna(cb_raw):
            continue
        cb = str(int(cb_raw)) if isinstance(cb_raw, float) and cb_raw == int(cb_raw) else str(cb_raw).strip()
        if not cb:
            continue
        spend = to_num(r.get("Списано ренбонусов"))
        if spend <= 0:
            continue
        wa = wallets[cb]
        if wa.spend_events == 0:
            wa.spend_events = 1
        else:
            wa.spend_events += 1
        # дата в агрегате агентов нет — относим к месяцу среза (конец периода)
        month_spend[spend_ym].add(cb)
        month_spend_slider[spend_ym].add(cb)


def load_active_agent_wallets() -> set[str]:
    if not PATH_AGENTS.exists():
        return set()
    try:
        df = pd.read_excel(PATH_AGENTS, sheet_name=0, header=0)
    except Exception:
        return set()
    s: set[str] = set()
    for _, r in df.iterrows():
        sid = r.get("subj_id")
        if pd.isna(sid):
            continue
        cb = str(int(sid)) if isinstance(sid, float) and sid == int(sid) else str(sid).strip()
        if cb:
            s.add(cb)
    return s


def scan_osago_partner_and_cross(paths: list[Path], fmap: dict[str, str]) -> dict:
    wallets: dict[str, WalletAgg] = defaultdict(WalletAgg)
    month_accrual: dict[str, set[str]] = defaultdict(set)
    month_spend: dict[str, set[str]] = defaultdict(set)
    month_spend_cross: dict[str, set[str]] = defaultdict(set)
    month_spend_kasko: dict[str, set[str]] = defaultdict(set)
    month_spend_slider: dict[str, set[str]] = defaultdict(set)
    month_issued: dict[str, set[str]] = defaultdict(set)
    first_acc_ym: dict[str, str] = {}
    nth_full = new_regional_nth()
    nth_r12 = new_regional_nth()
    nth_r3 = new_regional_nth()
    r12_start = trailing_window_start(END, 12)
    r3_start = trailing_window_start(END, 3)

    issued_total = 0
    cross_total = 0
    cross_discount_cnt = 0
    cross_with_rb_cnt = 0
    discount_finals: list[float] = []
    discount_policy_prices: list[float] = []

    for path in paths:
        if not path.exists():
            continue
        wb = openpyxl.load_workbook(path, read_only=True, data_only=True)
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
                wk = wallet_key(row, idx)
                role = str(cell(row, idx, "Role") or "").strip()
                if role in SELLER_ROLES and not wk:
                    continue
                state = str(cell(row, idx, "State") or "")
                if state in EXCLUDED:
                    continue
                dt = parse_dt(cell(row, idx, "CreateDate"))
                if dt is None or not in_window(dt):
                    continue
                if state != ISSUED:
                    continue

                cb = wk or str(cell(row, idx, "CashbookId") or "").strip()
                ym = ym_str(dt)
                wa = wallets[cb] if cb else None

                lp = to_num(cell(row, idx, "LoyaltyPointsInLK"))
                if cb and wa is not None and not is_null(cell(row, idx, "LoyaltyPointsInLK")) and lp > 0:
                    wa.has_accrual = True
                    _mark_accrual(cb, ym, month_accrual, first_acc_ym)

                if cb:
                    month_issued[ym].add(cb)

                if cb and wa is not None:
                    wa.osago_issued += 1
                issued_total += 1
                for reg in regions_for_wallet(cb, fmap):
                    nth_full[reg].osago_issued += 1
                    if dt >= r12_start:
                        nth_r12[reg].osago_issued += 1
                    if dt >= r3_start:
                        nth_r3[reg].osago_issued += 1

                if str(cell(row, idx, "CrossIsBought") or "").strip() != "Да":
                    continue
                cross_total += 1
                if cb and wa is not None:
                    wa.cross += 1

                pp_raw = cell(row, idx, "PolicyPrice")
                pp = to_num(pp_raw) if not is_null(pp_raw) else BASE_PRICE
                fp = to_num(cell(row, idx, "FinalPrice"))
                kv = to_num(cell(row, idx, "ChargedToIncreasedKV"))
                has_disc = not is_null(cell(row, idx, "FinalPrice")) and fp != pp and fp < pp
                has_kv = not is_null(cell(row, idx, "ChargedToIncreasedKV")) and kv != 0

                if has_disc:
                    cross_discount_cnt += 1
                    discount_finals.append(fp if fp > 0 else pp)
                    discount_policy_prices.append(pp)

                if has_disc or has_kv:
                    cross_with_rb_cnt += 1

                if cb and wa is not None and is_cross_spend_row(row, idx):
                    wa.spend_events += 1
                    wa.cross_spend_events += 1
                    month_spend[ym].add(cb)
                    month_spend_cross[ym].add(cb)
                    for reg in regions_for_wallet(cb, fmap):
                        nth_full[reg].cross_rb += 1
                        if dt >= r12_start:
                            nth_r12[reg].cross_rb += 1
                        if dt >= r3_start:
                            nth_r3[reg].cross_rb += 1
        wb.close()

    spend_ym = ym_str(END)
    scan_kasko_wallets(
        PATH_KASKO,
        wallets,
        month_accrual,
        month_spend,
        month_spend_kasko,
        month_issued,
        first_acc_ym,
        nth_full,
        nth_r12,
        nth_r3,
        r12_start,
        r3_start,
        fmap,
    )
    scan_slider_wallet_spend(PATH_SLIDER, wallets, month_spend, month_spend_slider, spend_ym)

    issued_period = {cb for cb, wa in wallets.items() if cb and wa.has_issued}
    accrual_period = {cb for cb, wa in wallets.items() if cb and wa.has_accrual}
    spend_period = {cb for cb, wa in wallets.items() if cb and wa.spend_events > 0}

    full_period_label = fmt_period_label(START, END)
    issued_r12 = partners_in_date_range(month_issued, r12_start, END)
    accrual_r12 = partners_in_date_range(month_accrual, r12_start, END)
    spend_r12 = partners_in_date_range(month_spend, r12_start, END)
    issued_r3 = partners_in_date_range(month_issued, r3_start, END)
    accrual_r3 = partners_in_date_range(month_accrual, r3_start, END)
    spend_r3 = partners_in_date_range(month_spend, r3_start, END)

    ref = END
    months_3 = last_complete_months(ref, 3)
    month_rows: list[dict] = []
    month_labels = ["янв", "фев", "мар", "апр", "май", "июн", "июл", "авг", "сен", "окт", "ноя", "дек"]

    for ym in months_3:
        y, mo = map(int, ym.split("-"))
        label = f"{month_labels[mo - 1]} {y}"
        m_start, m_end = month_range(ym)

        issued_m = month_issued.get(ym, set())
        acc_m = month_accrual.get(ym, set())
        spend_m = month_spend.get(ym, set())
        ever_acc_m = {cb for cb, y0 in first_acc_ym.items() if y0 <= ym}

        month_rows.append(
            {
                "ym": ym,
                "label": label,
                "withAccrual": len(acc_m),
                "issuedPartners": len(issued_m),
                "accrualSharePct": round(len(acc_m) / len(issued_m) * 100, 1) if issued_m else None,
                "withSpend": len(spend_m),
                "withAccrualEver": len(ever_acc_m),
                "spendShareOfAccrualsPct": round(len(spend_m) / len(ever_acc_m) * 100, 1) if ever_acc_m else None,
            }
        )

    agent_active = load_active_agent_wallets()
    engagement = compute_partner_engagement(wallets, fmap, agent_active, None)
    engagement_by_top3 = [
        {"region": label, **compute_partner_engagement(wallets, fmap, agent_active, label)}
        for label in TOP3_LABELS
    ]

    cross_loyalty = {
        "issuedOsago": issued_total,
        "crossTotal": cross_total,
        "everyNthCrossClient": max(1, round(issued_total / cross_total)) if cross_total else None,
        "bespolis": {
            "crossPolicies": cross_discount_cnt,
            "everyNthClient": max(1, round(issued_total / cross_discount_cnt)) if cross_discount_cnt else None,
            "pctWithRbSpendAmongCross": round(cross_with_rb_cnt / cross_total * 100, 1) if cross_total else None,
            "pctDiscountShareOfCross": round(cross_discount_cnt / cross_total * 100, 1) if cross_total else None,
            "avgCheckFinal": round(median(discount_finals)) if discount_finals else None,
            "avgCheckPolicy": round(median(discount_policy_prices)) if discount_policy_prices else None,
        },
        "note": "ДАГО и НС-пассажиры в выгрузке лояльности не размечены — только Кросс-Каско от бесполисных.",
    }

    return {
        "spendNthByMechanic": {
            "periodFull": full_period_label,
            "periodRolling12": fmt_period_label(r12_start, END),
            "periodRolling3": fmt_period_label(r3_start, END),
            "fullPeriodByTop3": spend_nth_rows(nth_full),
            "rolling12MonthsByTop3": spend_nth_rows(nth_r12),
            "rolling3MonthsByTop3": spend_nth_rows(nth_r3),
            "noteSlider3m": (
                "ОСАГО пролонгация (ползунок): дат в агрегате нет — «каждому N-му» только за всё время."
            ),
        },
        "partnerMetrics": {
            "periodLabel": full_period_label,
            "method": "Начисление: ≥1 РБ по ОСАГО и/или Каско ФЛ / оформили ОСАГО и/или Каско. Списание: ≥1 по любой механике / с накоплением.",
            "fullPeriod": partner_slice_with_mechanics(
                issued_period,
                accrual_period,
                spend_period,
                full_period_label,
                month_spend_cross,
                month_spend_kasko,
                month_spend_slider,
                START,
                END,
            ),
            "rolling12Months": partner_slice_with_mechanics(
                issued_r12,
                accrual_r12,
                spend_r12,
                fmt_period_label(r12_start, END),
                month_spend_cross,
                month_spend_kasko,
                month_spend_slider,
                r12_start,
                END,
            ),
            "rolling3Months": partner_slice_with_mechanics(
                issued_r3,
                accrual_r3,
                spend_r3,
                fmt_period_label(r3_start, END),
                month_spend_cross,
                month_spend_kasko,
                month_spend_slider,
                r3_start,
                END,
            ),
            "fullPeriodByTop3": partner_metrics_by_top3(
                fmap,
                month_issued,
                month_accrual,
                month_spend,
                month_spend_cross,
                month_spend_kasko,
                month_spend_slider,
                START,
                END,
                full_period_label,
            ),
            "rolling12MonthsByTop3": partner_metrics_by_top3(
                fmap,
                month_issued,
                month_accrual,
                month_spend,
                month_spend_cross,
                month_spend_kasko,
                month_spend_slider,
                r12_start,
                END,
                fmt_period_label(r12_start, END),
            ),
            "rolling3MonthsByTop3": partner_metrics_by_top3(
                fmap,
                month_issued,
                month_accrual,
                month_spend,
                month_spend_cross,
                month_spend_kasko,
                month_spend_slider,
                r3_start,
                END,
                fmt_period_label(r3_start, END),
            ),
            "last3Months": month_rows,
        },
        "partnerEngagement": engagement,
        "partnerEngagementByTop3": engagement_by_top3,
        "crossLoyalty": cross_loyalty,
    }


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


def scan_wallet_balances_for_avg(paths: list[Path]) -> tuple[dict[str, int | float], int]:
    balances: dict[str, float] = {}
    partners: set[str] = set()
    months: set[str] = set()
    for path in paths:
        if not path.exists():
            continue
        wb = openpyxl.load_workbook(path, read_only=True, data_only=True)
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
                state = str(cell(row, idx, "State") or "")
                if state in EXCLUDED or state != ISSUED:
                    continue
                dt = parse_dt(cell(row, idx, "CreateDate"))
                if dt is None or not in_window(dt):
                    continue
                months.add(ym_str(dt))
                cb = wallet_key(row, idx)
                if not cb:
                    continue
                partners.add(cb)
                av_raw = cell(row, idx, "AvailableForUsePoints")
                if not is_null(av_raw):
                    balances[cb] = max(balances.get(cb, 0.0), to_num(av_raw))
        wb.close()
    positive = [p for p in partners if balances.get(p, 0) > 0]
    n_all = len(partners)
    mean_all = sum(balances.get(p, 0) for p in partners) / n_all if n_all else 0.0
    mean_pos = sum(balances.get(p, 0) for p in positive) / len(positive) if positive else 0.0
    stats = {
        "meanAll": round(mean_all),
        "meanPositiveOnly": round(mean_pos),
        "allPartnersCount": n_all,
        "positiveBalanceCount": len(positive),
    }
    return stats, len(months)


def build_avg_bonus(total: Totals, balance: dict[str, int | float], month_count: int) -> dict:
    n = max(month_count, 1)
    return {
        "monthCount": month_count,
        "balanceMeanAll": int(balance["meanAll"]),
        "balanceMeanPositive": int(balance["meanPositiveOnly"]),
        "allPartnersCount": int(balance["allPartnersCount"]),
        "positiveBalanceCount": int(balance["positiveBalanceCount"]),
        "accrualTotal": round(total.acc_total),
        "spendTotal": round(total.spend_total),
        "spendDiscount": round(total.spend_cross_discount),
        "spendKv": round(total.spend_cross_kv),
        "avgAccrualPerMonth": round(total.acc_total / n),
        "avgSpendPerMonth": round(total.spend_total / n),
        "avgDiscountPerMonth": round(total.spend_cross_discount / n),
        "avgKvPerMonth": round(total.spend_cross_kv / n),
    }


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

    balance_stats, month_count = scan_wallet_balances_for_avg([PATH_OSAGO_2025, PATH_OSAGO_2026])
    avg_bonus = build_avg_bonus(total, balance_stats, month_count)

    extra = scan_osago_partner_and_cross([PATH_OSAGO_2025, PATH_OSAGO_2026], fmap)
    slider_top3 = aggregate_slider_top3(by_filial)
    for row in extra["spendNthByMechanic"]["fullPeriodByTop3"]:
        reg = row["region"]
        cnt = slider_top3.get(reg, 0)
        row["mechanics"]["osagoSlider"]["events"] = cnt
        base = row["mechanics"]["osagoSlider"]["baseIssuedOsago"]
        row["mechanics"]["osagoSlider"]["everyNthClient"] = every_nth_client(base, cnt)
    spend_by_product = {
        "osagoProlongation": round(total.spend_osago_slider),
        "kaskoWalletScoring": round(total.spend_kasko),
        "crossBespolisDiscount": round(total.spend_cross_discount),
        "crossBespolisKv": round(total.spend_cross_kv),
        "training": 0,
        "note": "Обучение в xlsx лояльности не выделено — 0 ₽.",
    }

    snapshot = {
        "generatedAt": datetime.now().strftime("%Y-%m-%d"),
        "periodLabel": "30.07.2025 – 18.11.2026",
        "agentFilialMapSize": len(fmap),
        "spendByProduct": spend_by_product,
        "avgBonus": avg_bonus,
        **extra,
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