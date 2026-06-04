#!/usr/bin/env python3
"""
import_monthly.py -- AllMyF Monthly Data Import
================================================
Reads 6 files from Monthly Dropbox/ and writes to the AllMyF Master Sheet
via Google Sheets API (gspread + service account).

Usage:
    python import_monthly.py --month May --year 2026 --usd-inr 95.3845
    python import_monthly.py --month May --year 2026 --usd-inr 95.3845 --dry-run

Flags:
    --month       Month name, e.g. "May"           (required)
    --year        4-digit year, e.g. 2026           (required)
    --usd-inr     RBI month-end USD/INR rate         (required)
    --dry-run     Print rows without writing          (optional)
    --dropbox     Path override for Monthly Dropbox   (optional)
    --credentials Path override for service_account.json (optional)

Files expected in Monthly Dropbox/:
    Zerodha_Holdings_[Month]_[Year].csv
    Zerodha_Tradebook_[Month]_[Year].xlsx or .csv
    Zerodha_PnL_[Month]_[Year].xlsx
    Vested_Holdings_[Month]_[Year].xlsx
    Vested_PnL_[Month]_[Year].xlsx
    AllMyF_Monthly_Manual_Update_[Month]_[Year].xlsx

Tabs written to:
    zerodha_holdings_import   (11 cols, dup-check: snapshot_month col B / index 1)
    trades_log                (11 cols, dup-check: trade_id col A / index 0)
    vested_holdings_import    (12 cols, dup-check: snapshot_month col B / index 1)
    monthly_pnl_log           (14 cols, dup-check: month col A / index 0)
    manual_assets             (14 cols, dup-check: snapshot_month+asset_id col A+B)
    workflow_log              (12 cols, one row per run)
"""

import argparse
import re
import sys
import uuid
from datetime import datetime
from pathlib import Path

import pandas as pd

SPREADSHEET_NAME = "AllMyF — Personal Finance Master Sheet"

SCOPES = [
    "https://www.googleapis.com/auth/spreadsheets",
    "https://www.googleapis.com/auth/drive.readonly",
]

_SCRIPT_DIR = Path(__file__).parent
_PROJECT_DIR = _SCRIPT_DIR.parent

DEFAULT_DROPBOX     = _PROJECT_DIR / "Monthly Dropbox"
DEFAULT_CREDENTIALS = _PROJECT_DIR / "credentials" / "service_account.json"

MONTH_TO_NUM = {
    "january": "01", "february": "02", "march": "03",  "april":    "04",
    "may":     "05", "june":     "06", "july":  "07",  "august":   "08",
    "september":"09","october":  "10", "november":"11", "december": "12",
}

APY_MONTHLY_CONTRIBUTION = 292


def parse_args():
    p = argparse.ArgumentParser(description="AllMyF monthly data import")
    p.add_argument("--month",       required=True)
    p.add_argument("--year",        required=True, type=int)
    p.add_argument("--usd-inr",     required=True, type=float, dest="usd_inr")
    p.add_argument("--dry-run",     action="store_true")
    p.add_argument("--dropbox",     type=Path, default=DEFAULT_DROPBOX)
    p.add_argument("--credentials", type=Path, default=DEFAULT_CREDENTIALS)
    return p.parse_args()


def make_snapshot_month(month, year):
    mm = MONTH_TO_NUM.get(month.lower())
    if not mm:
        sys.exit(f"ERROR: Unrecognised month '{month}'.")
    return f"{year}-{mm}"


def find_file(dropbox, pattern):
    matches = list(dropbox.glob(pattern))
    if not matches:
        if pattern.endswith(".csv"):
            matches = list(dropbox.glob(pattern[:-4] + ".xlsx"))
        elif pattern.endswith(".xlsx"):
            matches = list(dropbox.glob(pattern[:-5] + ".csv"))
    if not matches:
        sys.exit(f"ERROR: No file matching '{pattern}' in {dropbox}")
    if len(matches) > 1:
        sys.exit(f"ERROR: Multiple files matching '{pattern}': {[m.name for m in matches]}")
    return matches[0]


def to_float(val):
    if val is None:
        return ""
    if isinstance(val, float) and pd.isna(val):
        return ""
    try:
        return float(val)
    except (ValueError, TypeError):
        return ""


def cell_str(val, fallback=""):
    if val is None:
        return fallback
    if isinstance(val, float) and pd.isna(val):
        return fallback
    s = str(val).strip()
    return s if s and s.lower() != "nan" else fallback


def to_snap_month_str(val, fallback):
    if val is None or (isinstance(val, float) and pd.isna(val)):
        return fallback
    if hasattr(val, "strftime"):
        return val.strftime("%Y-%m")
    s = str(val).strip()
    if re.match(r"^\d{4}-\d{2}$", s):
        return s
    try:
        return pd.to_datetime(s).strftime("%Y-%m")
    except Exception:
        return fallback


def format_date_str(val):
    if val is None or (isinstance(val, float) and pd.isna(val)):
        return ""
    if hasattr(val, "strftime"):
        return val.strftime("%Y-%m-%d")
    s = str(val).strip()
    for fmt in ("%d/%m/%Y", "%Y-%m-%d", "%d-%m-%Y", "%m/%d/%Y"):
        try:
            return datetime.strptime(s, fmt).strftime("%Y-%m-%d")
        except ValueError:
            continue
    return s


def parse_sip_from_notes(notes_str):
    if not notes_str:
        return ""
    m = re.search(r"SIP\s+(\d[\d,]*)/month", notes_str, re.IGNORECASE)
    if m:
        try:
            return float(m.group(1).replace(",", ""))
        except ValueError:
            pass
    return ""


def row14(snap_month="", asset_id="", asset_name="", quantity="",
          unit="", invested="", current_val="", monthly_contrib="",
          rate="", maturity="", currency="INR",
          current_val_inr="", usd_inr_snap="", notes=""):
    return [snap_month, asset_id, asset_name, quantity, unit,
            invested, current_val, monthly_contrib, rate, maturity,
            currency, current_val_inr, usd_inr_snap, notes]


def parse_zerodha_holdings(path, snap_month):
    df = pd.read_csv(path)
    df = df.loc[:, ~df.columns.str.match(r"^Unnamed")]
    df = df.dropna(subset=["Instrument"])
    df = df[df["Instrument"].astype(str).str.strip() != ""]
    rows = []
    for _, r in df.iterrows():
        rows.append([
            "zerodha", snap_month,
            cell_str(r["Instrument"]),
            to_float(r.get("Qty.")),
            to_float(r.get("Avg. cost")),
            to_float(r.get("LTP")),
            to_float(r.get("Invested")),
            to_float(r.get("Cur. val")),
            to_float(r.get("P&L")),
            to_float(r.get("Net chg.")),
            "INR",
        ])
    invested_sum = round(pd.to_numeric(df["Invested"], errors="coerce").sum(), 4)
    current_sum  = round(pd.to_numeric(df["Cur. val"], errors="coerce").sum(), 4)
    return rows, invested_sum, current_sum


def parse_zerodha_tradebook(path):
    is_csv = path.suffix.lower() == ".csv"
    if is_csv:
        df = pd.read_csv(path, header=0, dtype=str)
        df = df.dropna(subset=["symbol"])
        df = df[df["symbol"].str.strip().ne("")]
        rows = []
        for _, r in df.iterrows():
            tid = cell_str(r.get("trade_id", ""))
            if not tid:
                continue
            rows.append([
                tid, "zerodha",
                cell_str(r.get("symbol", "")),
                cell_str(r.get("isin", "")),
                format_date_str(r.get("trade_date", "")),
                cell_str(r.get("trade_type", "")).lower(),
                to_float(r.get("quantity")),
                to_float(r.get("price")),
                "INR",
                cell_str(r.get("exchange", "")),
                cell_str(r.get("order_execution_time", "")),
            ])
        return rows
    else:
        raw = pd.read_excel(path, header=None, dtype=str)
        header_idx = None
        for i, row in raw.iterrows():
            if any(cell_str(v) == "Symbol" for v in row):
                header_idx = i
                break
        if header_idx is None:
            raise ValueError(f"Could not find 'Symbol' header in {path.name}")
        df = pd.read_excel(path, header=header_idx, dtype=str)
        df = df.dropna(subset=["Symbol"])
        df = df[df["Symbol"].str.strip().ne("")]
        rows = []
        for _, r in df.iterrows():
            tid = cell_str(r.get("Trade ID", ""))
            if not tid:
                continue
            rows.append([
                tid, "zerodha",
                cell_str(r.get("Symbol", "")),
                cell_str(r.get("ISIN", "")),
                format_date_str(r.get("Trade Date", "")),
                cell_str(r.get("Trade Type", "")).lower(),
                to_float(r.get("Quantity")),
                to_float(r.get("Price")),
                "INR",
                cell_str(r.get("Exchange", "")),
                cell_str(r.get("Order Execution Time", "")),
            ])
        return rows


def parse_zerodha_pnl(path):
    df = pd.read_excel(path, sheet_name="Equity", header=None)
    result = {"realized_pnl": 0.0, "unrealized_pnl": 0.0, "charges": 0.0}
    lm = {"Realized P&L": "realized_pnl", "Unrealized P&L": "unrealized_pnl", "Charges": "charges"}
    for _, row in df.iterrows():
        nn = [v for v in row if not (isinstance(v, float) and pd.isna(v)) and str(v).strip()]
        if len(nn) >= 2 and str(nn[0]).strip() in lm:
            try:
                result[lm[str(nn[0]).strip()]] = float(nn[1])
            except (ValueError, TypeError):
                pass
    return result


def parse_vested_holdings(path, snap_month):
    df = pd.read_excel(path, sheet_name="Holdings", header=0)
    df = df.dropna(subset=["Ticker"])
    df = df[df["Ticker"].astype(str).str.strip().ne("")]
    rows = []
    for _, r in df.iterrows():
        rows.append([
            "vested", snap_month,
            cell_str(r.get("Ticker", "")),
            cell_str(r.get("Name", "")),
            to_float(r.get("Total Shares Held")),
            to_float(r.get("Average Cost (USD)")),
            to_float(r.get("Current Price (USD)")),
            to_float(r.get("Total Amount Invested (USD)")),
            to_float(r.get("Current Value (USD)")),
            to_float(r.get("Investment Returns (USD)")),
            to_float(r.get("Investment Returns (%)")),
            "USD",
        ])
    return rows


def parse_vested_pnl(path, fallback_usd_inr=None):
    result = {
        "realized_pnl_usd": 0.0, "realized_pnl_inr": 0.0,
        "unrealized_pnl_usd": 0.0, "unrealized_pnl_inr": 0.0,
        "invested_usd": 0.0, "current_usd": 0.0, "usd_inr_rate": None,
    }
    xl = pd.ExcelFile(path)
    sheets = xl.sheet_names

    def fs(kw):
        return next((s for s in sheets if kw in s), None)

    def col(df, *names):
        for n in names:
            if n in df.columns:
                return pd.to_numeric(df[n], errors="coerce")
        return pd.Series([0.0] * len(df))

    s = fs("Realized P&L - Breakdown")
    if s:
        df = pd.read_excel(path, sheet_name=s, header=0)
        df = df.dropna(subset=["Security"])
        if not df.empty and "USD Reference Rate (INR)" in df.columns:
            rc = pd.to_numeric(df["USD Reference Rate (INR)"], errors="coerce").dropna()
            if not rc.empty:
                result["usd_inr_rate"] = float(rc.iloc[-1])

    rate = result["usd_inr_rate"] if result["usd_inr_rate"] is not None else (fallback_usd_inr or 0.0)

    s = fs("Unrealized P&L - Summary")
    if s:
        df = pd.read_excel(path, sheet_name=s, header=0)
        df = df.dropna(subset=["Security"])
        pnl_usd = col(df, "Profit/Loss (USD)").sum()
        pnl_inr = col(df, "Profit/Loss (INR)").sum()
        if pnl_inr == 0.0 and rate:
            pnl_inr = round(pnl_usd * rate, 4)
        result["unrealized_pnl_usd"] = round(pnl_usd, 4)
        result["unrealized_pnl_inr"] = round(pnl_inr, 4)
        result["invested_usd"]        = round(col(df, "Cost Basis (USD)").sum(), 4)
        result["current_usd"]         = round(col(df, "Market Value (USD)").sum(), 4)

    s = fs("Realized P&L - Summary")
    if s:
        df = pd.read_excel(path, sheet_name=s, header=0)
        df = df.dropna(subset=["Security"])
        pnl_usd = col(df, "Profit/Loss (USD)").sum()
        pnl_inr = col(df, "Profit/Loss (INR)").sum()
        if pnl_inr == 0.0 and rate:
            pnl_inr = round(pnl_usd * rate, 4)
        result["realized_pnl_usd"] = round(pnl_usd, 4)
        result["realized_pnl_inr"] = round(pnl_inr, 4)

    return result


def parse_manual_assets(path, snap_month, usd_inr):
    rows = []
    warnings = []
    xl = pd.ExcelFile(path)

    df = pd.read_excel(path, sheet_name="Commodities", header=None)
    r = df.iloc[3]
    rows.append(row14(snap_month=to_snap_month_str(r[1], snap_month),
                      asset_id="MANUAL_COMMODITY_DIGITAL_GOLD",
                      asset_name=cell_str(r[0], "Digital Gold"),
                      quantity=to_float(r[2]), unit="grams",
                      monthly_contrib=to_float(r[3])))
    r = df.iloc[7]
    rows.append(row14(snap_month=to_snap_month_str(r[1], snap_month),
                      asset_id="MANUAL_COMMODITY_DIGITAL_SILVER",
                      asset_name=cell_str(r[0], "Digital Silver"),
                      quantity=to_float(r[2]), unit="grams",
                      monthly_contrib=to_float(r[3])))
    r = df.iloc[11]
    rows.append(row14(snap_month=snap_month,
                      asset_id="MANUAL_COMMODITY_SGB_2021",
                      asset_name=cell_str(r[0], "SGB 2021-22 Series"),
                      quantity=to_float(r[1]), unit="grams",
                      invested=to_float(r[2]), current_val=to_float(r[2]),
                      maturity=cell_str(r[3], "2029"), monthly_contrib=0))

    df = pd.read_excel(path, sheet_name="Fixed_Income", header=None)
    for i in [3, 4]:
        r = df.iloc[i]
        aid = cell_str(r[0])
        if not aid.startswith("MANUAL_BOND"):
            continue
        iv = to_float(r[2])
        rows.append(row14(snap_month=snap_month, asset_id=aid,
                          asset_name=cell_str(r[1]), invested=iv,
                          current_val=iv, rate=to_float(r[3]),
                          maturity=format_date_str(r[5]),
                          currency=cell_str(r[6], "INR")))
    for i in [8, 9, 10]:
        r = df.iloc[i]
        aid = cell_str(r[0])
        if not aid.startswith("MANUAL_FD"):
            continue
        iv = to_float(r[2])
        cur = cell_str(r[5], "INR")
        cvi = ""
        usd_s = ""
        if cur == "USD" and isinstance(iv, float):
            cvi = round(iv * usd_inr, 2)
            usd_s = usd_inr
        rows.append(row14(snap_month=snap_month, asset_id=aid,
                          asset_name=cell_str(r[1]), invested=iv,
                          current_val=iv, rate=to_float(r[3]),
                          maturity=format_date_str(r[4]), currency=cur,
                          current_val_inr=cvi, usd_inr_snap=usd_s))
    r = df.iloc[14]
    rows.append(row14(snap_month=to_snap_month_str(r[4], snap_month),
                      asset_id=cell_str(r[0]), asset_name=cell_str(r[1]),
                      monthly_contrib=to_float(r[2]),
                      current_val=to_float(r[3])))

    df = pd.read_excel(path, sheet_name="Retirement", header=None)
    r = df.iloc[3]
    rows.append(row14(snap_month=to_snap_month_str(r[1], snap_month),
                      asset_id=cell_str(r[0]), asset_name="eNPS",
                      monthly_contrib=to_float(r[2]),
                      invested=to_float(r[3]), current_val=to_float(r[4])))
    r = df.iloc[7]
    rows.append(row14(snap_month=to_snap_month_str(r[1], snap_month),
                      asset_id=cell_str(r[0]), asset_name="APY",
                      monthly_contrib=APY_MONTHLY_CONTRIBUTION,
                      current_val=to_float(r[3])))
    r = df.iloc[11]
    rows.append(row14(snap_month=to_snap_month_str(r[1], snap_month),
                      asset_id=cell_str(r[0]), asset_name="EPFO",
                      monthly_contrib=0, current_val=to_float(r[2])))

    df = pd.read_excel(path, sheet_name="SIP_Funds", header=3)
    df = df.dropna(subset=["Asset ID"])
    df = df[df["Asset ID"].astype(str).str.strip().str.startswith("MF_")]
    for _, r in df.iterrows():
        ns = cell_str(r.get("Notes", ""))
        mc = parse_sip_from_notes(ns)
        rows.append(row14(
            snap_month=to_snap_month_str(r.get("Snapshot Month"), snap_month),
            asset_id=cell_str(r["Asset ID"]),
            asset_name=cell_str(r.get("Fund Name", "")),
            quantity=to_float(r.get("Units Held")),
            unit="units",
            invested=to_float(r.get("Total Invested (INR)")),
            monthly_contrib=mc,
            notes=ns))

    df = pd.read_excel(path, sheet_name="Static_Funds", header=None)
    for i in [5, 6, 7, 8]:
        r = df.iloc[i]
        aid = cell_str(r[0])
        if not aid.startswith("MF_"):
            continue
        rows.append(row14(snap_month=snap_month, asset_id=aid,
                          asset_name=cell_str(r[1]),
                          quantity=to_float(r[2]), unit="units",
                          invested=to_float(r[3])))
    for i in [12, 13]:
        r = df.iloc[i]
        aid = cell_str(r[0])
        if not aid.startswith("EU_"):
            continue
        cv = to_float(r[3])
        cvi = round(cv * usd_inr, 2) if isinstance(cv, float) else ""
        rows.append(row14(snap_month=to_snap_month_str(r[4], snap_month),
                          asset_id=aid, asset_name=cell_str(r[1]),
                          invested=to_float(r[2]), current_val=cv,
                          currency=cell_str(r[5], "USD"),
                          current_val_inr=cvi, usd_inr_snap=usd_inr))

    if "Vests" in xl.sheet_names:
        raw_v = pd.read_excel(path, sheet_name="Vests", header=None, dtype=str)
        vh_idx = None
        for i, row in raw_v.iterrows():
            if any(str(v).strip() == "Asset ID" for v in row):
                vh_idx = i
                break
        if vh_idx is None:
            warnings.append("Could not find 'Asset ID' header in Vests sheet -- skipped.")
        else:
            df = pd.read_excel(path, sheet_name="Vests", header=vh_idx)
            df = df.dropna(subset=["Asset ID"])
            df = df[df["Asset ID"].astype(str).str.strip().str.startswith("VEST_")]
            vest_count = 0
            for _, r in df.iterrows():
                cv = to_float(r.get("Current Value (USD)"))
                cvi = round(cv * usd_inr, 2) if isinstance(cv, float) else ""
                rows.append(row14(
                    snap_month=to_snap_month_str(r.get("Snapshot Month"), snap_month),
                    asset_id=cell_str(r["Asset ID"]),
                    asset_name=cell_str(r.get("Vest Name", "")),
                    invested=to_float(r.get("Amount Invested (USD)")),
                    current_val=cv, currency="USD",
                    current_val_inr=cvi, usd_inr_snap=usd_inr,
                    notes=cell_str(r.get("Notes", ""))))
                vest_count += 1
            print(f"    -> {vest_count} Vest rows")
    else:
        warnings.append("No 'Vests' sheet found -- Vest entries skipped.")

    return rows, warnings


def connect_spreadsheet(credentials_path, spreadsheet_name):
    try:
        from google.oauth2.service_account import Credentials
        import gspread
    except ImportError:
        sys.exit("ERROR: gspread or google-auth not installed. Run: pip install gspread google-auth")
    if not credentials_path.exists():
        sys.exit(f"ERROR: Credentials not found: {credentials_path}")
    creds = Credentials.from_service_account_file(str(credentials_path), scopes=SCOPES)
    client = gspread.authorize(creds)
    try:
        return client.open(spreadsheet_name)
    except Exception as e:
        sys.exit(f"ERROR: Could not open spreadsheet: {e}")


def all_col_values(ws, col_index):
    vals = ws.get_all_values()
    if len(vals) <= 1:
        return set()
    return {row[col_index] for row in vals[1:] if len(row) > col_index and row[col_index]}


def find_duplicate_manual_assets(ws, snap_month, candidate_ids):
    vals = ws.get_all_values()
    if len(vals) <= 1:
        return set()
    existing = {row[1] for row in vals[1:] if len(row) > 1 and row[0] == snap_month and row[1]}
    return existing.intersection(set(candidate_ids))


def main():
    args = parse_args()
    month      = args.month.capitalize()
    year       = args.year
    usd_inr    = args.usd_inr
    dry_run    = args.dry_run
    dropbox    = args.dropbox
    snap_month = make_snapshot_month(month, year)

    div = "=" * 65
    print(f"\n{div}")
    print(f"  AllMyF Monthly Import -- {month} {year}")
    print(f"  Snapshot month : {snap_month}")
    print(f"  USD/INR (CLI)  : {usd_inr}")
    print(f"  Mode           : {'DRY RUN' if dry_run else 'LIVE'}")
    print(f"  Dropbox        : {dropbox}")
    print(div)

    print(f"\n[1/6] Locating files...")
    f_zh = find_file(dropbox, f"Zerodha_Holdings_{month}_{year}.csv")
    f_zt = find_file(dropbox, f"Zerodha_Tradebook_{month}_{year}.xlsx")
    f_zp = find_file(dropbox, f"Zerodha_PnL_{month}_{year}.xlsx")
    f_vh = find_file(dropbox, f"Vested_Holdings_{month}_{year}.xlsx")
    f_vp = find_file(dropbox, f"Vested_PnL_{month}_{year}.xlsx")
    f_mu = find_file(dropbox, f"AllMyF_Monthly_Manual_Update_{month}_{year}.xlsx")
    print(f"  OK  {f_zh.name}")
    print(f"  OK  {f_zt.name}")
    print(f"  OK  {f_zp.name}")
    print(f"  OK  {f_vh.name}")
    print(f"  OK  {f_vp.name}")
    print(f"  OK  {f_mu.name}")

    print(f"\n[2/6] Parsing files...")
    print("  Zerodha Holdings...")
    zh_rows, zh_inv, zh_cur = parse_zerodha_holdings(f_zh, snap_month)
    print(f"    -> {len(zh_rows)} rows | Invested Rs{zh_inv:,.2f} | Current Rs{zh_cur:,.2f}")

    print("  Zerodha Tradebook...")
    zt_rows = parse_zerodha_tradebook(f_zt)
    print(f"    -> {len(zt_rows)} trade rows")

    print("  Zerodha P&L...")
    zp = parse_zerodha_pnl(f_zp)
    print(f"    -> Realized Rs{zp['realized_pnl']:,.2f} | Unrealized Rs{zp['unrealized_pnl']:,.2f} | Charges Rs{zp['charges']:,.2f}")

    print("  Vested Holdings...")
    vh_rows = parse_vested_holdings(f_vh, snap_month)
    print(f"    -> {len(vh_rows)} rows")

    print("  Vested P&L...")
    vp = parse_vested_pnl(f_vp, fallback_usd_inr=usd_inr)
    if vp["usd_inr_rate"] is not None:
        usd_inr_used = vp["usd_inr_rate"]
        print(f"    -> USD/INR from file: {usd_inr_used}")
    else:
        usd_inr_used = usd_inr
        print(f"    -> No rate in file, using CLI: {usd_inr_used}")
    print(f"    -> Realized ${vp['realized_pnl_usd']:,.2f} | Unrealized ${vp['unrealized_pnl_usd']:,.2f}")
    print(f"    -> Invested ${vp['invested_usd']:,.2f} | Current ${vp['current_usd']:,.2f}")

    print("  Manual Assets...")
    ma_rows, ma_warnings = parse_manual_assets(f_mu, snap_month, usd_inr_used)
    print(f"    -> {len(ma_rows)} rows")
    for w in ma_warnings:
        print(f"    [!] {w}")

    pnl_row = [
        snap_month,
        round(zp["realized_pnl"], 4), round(zp["unrealized_pnl"], 4), round(zp["charges"], 4),
        round(zh_inv, 4), round(zh_cur, 4),
        round(vp["realized_pnl_usd"], 4), round(vp["realized_pnl_inr"], 4),
        round(vp["unrealized_pnl_usd"], 4), round(vp["unrealized_pnl_inr"], 4),
        round(vp["invested_usd"], 4), round(vp["current_usd"], 4),
        usd_inr_used, f"{month} {year} -- Python import",
    ]

    print(f"\n[3/6] Connecting to Google Sheets...")
    anomalies = list(ma_warnings)

    if dry_run:
        print("  [DRY RUN] Skipping connection.")
        zh_dup = vh_dup = pnl_dup = False
        zt_dups = set()
        ma_dups = set()
    else:
        ss     = connect_spreadsheet(args.credentials, SPREADSHEET_NAME)
        ws_zh  = ss.worksheet("zerodha_holdings_import")
        ws_zt  = ss.worksheet("trades_log")
        ws_vh  = ss.worksheet("vested_holdings_import")
        ws_pnl = ss.worksheet("monthly_pnl_log")
        ws_ma  = ss.worksheet("manual_assets")
        ws_wf  = ss.worksheet("workflow_log")
        print("  Connected OK")

        print(f"\n[4/6] Duplicate checks...")
        zh_dup  = snap_month in all_col_values(ws_zh, 1)
        vh_dup  = snap_month in all_col_values(ws_vh, 1)
        pnl_dup = snap_month in all_col_values(ws_pnl, 0)
        ex_t    = all_col_values(ws_zt, 0)
        zt_dups = ex_t.intersection({r[0] for r in zt_rows})
        ma_dups = find_duplicate_manual_assets(ws_ma, snap_month, [r[1] for r in ma_rows])
        print(f"  ZH: {'DUP' if zh_dup else 'clean'} | VH: {'DUP' if vh_dup else 'clean'} | PnL: {'DUP' if pnl_dup else 'clean'}")
        print(f"  Trades dupes: {len(zt_dups)} | Manual asset dupes: {len(ma_dups)}")

    print(f"\n[5/6] {'Preview' if dry_run else 'Writing'}...")
    rows_written = {}

    def write_tab(ws, new_rows):
        if dry_run or not new_rows:
            return
        ws.append_rows(new_rows, value_input_option="RAW", insert_data_option="INSERT_ROWS")

    if zh_dup:
        rows_written["zerodha_holdings_import"] = 0
        anomalies.append(f"zerodha_holdings_import: {snap_month} already present")
    else:
        write_tab(ws_zh if not dry_run else None, zh_rows)
        rows_written["zerodha_holdings_import"] = len(zh_rows)

    clean_zt = [r for r in zt_rows if r[0] not in zt_dups]
    write_tab(ws_zt if not dry_run else None, clean_zt)
    rows_written["trades_log"] = len(clean_zt)

    if vh_dup:
        rows_written["vested_holdings_import"] = 0
        anomalies.append(f"vested_holdings_import: {snap_month} already present")
    else:
        write_tab(ws_vh if not dry_run else None, vh_rows)
        rows_written["vested_holdings_import"] = len(vh_rows)

    if pnl_dup:
        rows_written["monthly_pnl_log"] = 0
        anomalies.append(f"monthly_pnl_log: {snap_month} already present")
    else:
        write_tab(ws_pnl if not dry_run else None, [pnl_row])
        rows_written["monthly_pnl_log"] = 1

    clean_ma = [r for r in ma_rows if r[1] not in ma_dups]
    write_tab(ws_ma if not dry_run else None, clean_ma)
    rows_written["manual_assets"] = len(clean_ma)

    run_id   = str(uuid.uuid4())[:8].upper()
    run_date = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
    mi_total = sum(rows_written.get(k, 0) for k in
                   ["zerodha_holdings_import", "trades_log", "vested_holdings_import", "monthly_pnl_log"])
    wf_row = [run_id, run_date, snap_month, 6, mi_total,
              rows_written["manual_assets"], 0, len(anomalies), 0,
              "yes" if not dry_run else "dry-run",
              "dry-run" if dry_run else "success",
              "; ".join(anomalies) if anomalies else ""]
    if not dry_run:
        write_tab(ws_wf, [wf_row])
        rows_written["workflow_log"] = 1

    print(f"\n{div}")
    print(f"  SUMMARY -- {month} {year}  ({'DRY RUN' if dry_run else 'LIVE'})")
    print(div)
    for tab, count in rows_written.items():
        status = f"{count} rows" if count > 0 else "SKIPPED (duplicate)"
        print(f"  {tab:<35} {status}")
    print(f"\n  Anomalies: {anomalies if anomalies else 'none'}")
    print(f"  Run ID   : {run_id}")
    print(f"{div}\n")


if __name__ == "__main__":
    main()
