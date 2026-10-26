#!/usr/bin/env python3
"""Independent, read-only Decimal replay of an operating-brief evidence bundle.

No CRM module, displayed total, or JavaScript helper is used as a calculation
input. ``expected`` is compared only AFTER source facts have been computed.

Usage:
  python3 scripts/verifyOperatingBriefEvidence.py --seal raw-bundle.json > sealed.json
  python3 scripts/verifyOperatingBriefEvidence.py sealed.json > verification.json

Sealing adds hashes; it does not establish authenticity or query completeness.
The collector must supply collection_metadata with read_complete/expected_count.
Exit 0: checked scope agrees; 1: difference or unsupported evidence; 2: bad input.
The report always excludes bank settlement, physical loss and atomic-snapshot
claims. Missing fields, unsupported legacy semantics and partial collections are
reported explicitly instead of turning unknown values into zero.
"""
from __future__ import annotations

import argparse
import calendar
import hashlib
import json
import re
import sys
from collections import defaultdict
from datetime import date, datetime, timedelta, timezone
from decimal import Decimal, InvalidOperation, ROUND_DOWN, ROUND_HALF_UP

SCHEMA = "operating-brief-evidence/1"
RULE = "sale-accounting/2026-09-08.1"
VERSION = "operating-brief-independent/2026-10-26.1"
TABLES = {"customers": "crm_customers", "sales": "crm_sale_records",
          "flows": "crm_customer_flow_settlements", "receipts": "crm_customer_receipts",
          "allocations": "crm_customer_allocations", "intakes": "crm_cashier_intakes",
          "debts": "crm_customer_opening_debts", "fillings": "crm_fillings"}
ZERO = Decimal(0)
NONCASH = {"opening_prepay", "deposit_transfer", "settlement_fee"}
CASH_SOURCES = {"", "cashier_intake", "customer_prepay_manual", "customer_receipt",
                "customer_cash_refund", "offset_credit_cash_refund", "sale_quick_receive",
                "sale", "manual", "flow_settlement", "opening_debt"}


def canonical(value):
    return json.dumps(value, sort_keys=True, ensure_ascii=False, separators=(",", ":"),
                      allow_nan=False).encode("utf-8")


def digest(value):
    return hashlib.sha256(canonical(value)).hexdigest()


def seal(bundle):
    result = dict(bundle)
    result["manifest"] = {name: {"count": len(rows), "sha256": digest(rows)}
                          for name, rows in bundle.get("collections", {}).items()}
    result["manifest_digest"] = digest(result["manifest"])
    return result


def text(value):
    return "" if value is None else str(value).strip()


def dec(value, *, optional=False, signed=True):
    if value is None and optional:
        return ZERO
    if isinstance(value, bool) or not isinstance(value, (int, float, str, Decimal)) or not text(value):
        raise ValueError("missing_or_invalid_number")
    try:
        n = Decimal(text(value))
    except InvalidOperation as error:
        raise ValueError("invalid_number") from error
    if not n.is_finite() or (not signed and n < 0):
        raise ValueError("invalid_number")
    return n


def quantize(n, digits=3, rounding=ROUND_HALF_UP):
    return n.quantize(Decimal(1).scaleb(-digits), rounding=rounding)


def money(value, digits=3, optional=False, signed=True):
    n = dec(value, optional=optional, signed=signed)
    if n != quantize(n, digits):
        raise ValueError("invalid_money_precision")
    return n


def day(value):
    if not isinstance(value, str) or not re.fullmatch(r"\d{4}-\d{2}-\d{2}", value):
        raise ValueError("invalid_business_date")
    return date.fromisoformat(value)


def active(row, kind):
    status = row.get("status")
    if status == "void":
        return False
    if status == "posted" or (kind in {"sales", "allocations"} and not status):
        return True
    raise ValueError("unsupported_source_status")


def cash_kind(row):
    source = text(row.get("source_type"))
    offset = source.startswith("sale_offset_credit") or text(row.get("entry_kind")).lower() in {"offset", "offset_credit"}
    if offset:
        return "offset"
    if source in NONCASH:
        return "noncash"
    if source not in CASH_SOURCES:
        raise ValueError("unrecognized_receipt_source")
    return "cash"


class Replay:
    def __init__(self, bundle):
        self.bundle = bundle
        self.differences = []
        self.unsupported = []
        self.checks = defaultdict(int)
        self.excluded = defaultdict(int)
        self.derived = {}
        self.collections = bundle.get("collections", {})
        self.customers = {text(row.get("_id")): row for row in self.collections.get(TABLES["customers"], [])}
        self.facts = defaultdict(list)
        self.expected_checks = 0
        self.expected_paths = []
        self.ignored_expected_paths = []
        self.allocation_facts = []

    def unknown(self, area, code, row=None, field=None):
        issue = {"area": area, "code": code}
        if row is not None:
            issue["source_id"] = text(row.get("_id"))
        if field:
            issue["field"] = field
        if issue not in self.unsupported:
            self.unsupported.append(issue)

    def equal(self, path, observed, computed, category="expected"):
        self.checks[category] += 1
        if category == "expected":
            self.expected_checks += 1
            self.expected_paths.append(path)
        if isinstance(computed, Decimal):
            try:
                same = dec(observed) == computed
            except ValueError:
                same = False
        else:
            same = observed == computed
        if not same:
            self.differences.append({"path": path, "observed": observed, "computed": computed})

    def integrity(self):
        if self.bundle.get("schema") != SCHEMA:
            self.unknown("integrity", "unsupported_bundle_schema")
        if self.bundle.get("rule_version") != RULE:
            self.unknown("integrity", "unsupported_rule_version")
        try:
            start = dec(self.bundle.get("read_started_at"), signed=False)
            end = dec(self.bundle.get("read_completed_at"), signed=False)
            if start <= 0 or end < start:
                raise ValueError()
        except ValueError:
            self.unknown("integrity", "invalid_read_window")
        metadata = self.bundle.get("collection_metadata", {})
        manifest = self.bundle.get("manifest", {})
        self.equal("manifest_digest", self.bundle.get("manifest_digest"), digest(manifest), "integrity")
        for kind, name in TABLES.items():
            if name not in self.collections:
                self.unknown("integrity", "missing_collection", field=name)
                continue
            rows = self.collections[name]
            if not isinstance(rows, list):
                self.unknown("integrity", "invalid_collection", field=name)
                continue
            entry = manifest.get(name, {})
            self.equal(f"manifest.{name}.count", entry.get("count"), len(rows), "integrity")
            self.equal(f"manifest.{name}.sha256", entry.get("sha256"), digest(rows), "integrity")
            meta = metadata.get(name, {})
            if meta.get("read_complete") is not True:
                self.unknown("integrity", "collection_read_not_proven", field=name)
            self.equal(f"collection_metadata.{name}.expected_count", meta.get("expected_count"), len(rows), "integrity")
            ids = set()
            for row in rows:
                if not isinstance(row, dict) or not text(row.get("_id")) or row["_id"] in ids:
                    self.unknown("integrity", "duplicate_or_missing_source_id", row if isinstance(row, dict) else None, name)
                else:
                    ids.add(row["_id"])

    def owner(self, row, kind):
        customer_id = text(row.get("customer_id"))
        if self.customers.get(customer_id, {}).get("is_hidden") is True:
            self.excluded[f"{kind}.hidden"] += 1
            return None
        delivery = text(row.get("delivery_customer_id")) if kind == "sales" else ""
        if delivery and self.customers.get(delivery, {}).get("is_hidden") is True:
            self.excluded[f"{kind}.hidden_delivery"] += 1
            return None

        def root(identifier):
            visited = set()
            for _ in range(10):
                item = self.customers.get(identifier)
                if not item or item.get("is_hidden") is True:
                    raise ValueError("unknown_customer_owner")
                if identifier in visited:
                    raise ValueError("customer_owner_cycle")
                visited.add(identifier)
                parent = text(item.get("settlement_customer_id"))
                if not parent or parent == identifier:
                    return identifier
                identifier = parent
            raise ValueError("customer_owner_cycle")

        resolved = root(customer_id)
        if resolved != customer_id or delivery and root(delivery) != resolved:
            raise ValueError("customer_owner_mismatch")
        return resolved

    @staticmethod
    def sale_weight(row):
        mode = text(row.get("biz_mode")) or "bottle"
        if mode == "bottle":
            if not isinstance(row.get("out_items"), list) and not isinstance(row.get("back_items"), list):
                raise ValueError("missing_bottle_weight_rows")
            totals = []
            for key in ("out_items", "back_items"):
                rows = row.get(key, [])
                if not isinstance(rows, list):
                    raise ValueError("invalid_bottle_weight_rows")
                totals.append(sum((dec(item.get("net")) for item in rows), ZERO))
            return quantize(totals[0] - totals[1], 2)
        if mode == "agent_sale":
            rows = row.get("agent_sale_items")
            if not isinstance(rows, list):
                raise ValueError("missing_agent_weight_rows")
            return quantize(sum((dec(item.get("fill_weight"), signed=False) for item in rows), ZERO), 2)
        if mode != "truck":
            raise ValueError("unknown_sale_mode")
        for key in ("truck_out_gross", "truck_back_gross", "truck_gross_diff", "truck_settle_gross", "truck_settle_tare", "truck_sale_net"):
            if row.get(key) is not None:
                dec(row[key], signed=False)
        reference = None
        if row.get("truck_out_gross") is not None and row.get("truck_back_gross") is not None:
            reference = max(dec(row["truck_out_gross"]) - dec(row["truck_back_gross"]), ZERO)
        elif row.get("truck_gross_diff") is not None:
            reference = dec(row["truck_gross_diff"], signed=False)
        settlement = None
        if row.get("truck_settle_gross") is not None and row.get("truck_settle_tare") is not None:
            settlement = max(dec(row["truck_settle_gross"]) - dec(row["truck_settle_tare"]), ZERO)
        elif row.get("truck_sale_net") is not None:
            settlement = dec(row["truck_sale_net"], signed=False)
        if (text(row.get("price_unit")) or "kg") == "kg" and settlement is not None and settlement > 0:
            return quantize(settlement, 2)
        if reference is None:
            raise ValueError("missing_truck_reference_weight")
        return quantize(reference, 2)

    @staticmethod
    def sale_principal(row):
        unit = text(row.get("price_unit")) or "kg"
        settlement = text(row.get("settlement_mode"))
        if settlement == "customer_flow":
            return ZERO
        if settlement not in {"", "sale"} or not settlement and unit == "m3":
            raise ValueError("settlement_mode_unresolved")
        price = dec(row.get("unit_price"), signed=False)
        mode = text(row.get("biz_mode")) or "bottle"
        if unit not in {"kg", "bottle", "m3"}:
            raise ValueError("unknown_price_unit")
        if mode == "agent_sale":
            rows = row.get("agent_sale_items")
            if not isinstance(rows, list):
                raise ValueError("missing_agent_weight_rows")
            quantity = sum((dec(item.get("fill_weight"), signed=False) for item in rows), ZERO)
        elif unit == "kg":
            # Money uses raw quantities, while the public weight is rounded per
            # sales document. Do not multiply an already-rounded display weight.
            if mode == "bottle":
                if not isinstance(row.get("out_items"), list) and not isinstance(row.get("back_items"), list):
                    raise ValueError("missing_bottle_weight_rows")
                quantity = sum((dec(item.get("net")) for item in row.get("out_items", [])), ZERO) - sum((dec(item.get("net")) for item in row.get("back_items", [])), ZERO)
            elif mode == "truck":
                # More than two raw truck decimals require separate policy
                # evidence; the deployed rule may multiply before rounding.
                quantity = Replay.sale_weight(row)
                if any(dec(row[key]) != quantize(dec(row[key]), 2) for key in ("truck_sale_net", "truck_gross_diff", "truck_settle_gross", "truck_settle_tare", "truck_out_gross", "truck_back_gross") if row.get(key) is not None):
                    raise ValueError("truck_fractional_precision_not_replayed")
            else:
                raise ValueError("unknown_sale_mode")
        elif unit == "bottle":
            rows = row.get("out_items")
            if not isinstance(rows, list):
                raise ValueError("missing_bottle_count_rows")
            quantity = Decimal(len(rows))
        else:
            if row.get("flow_volume_m3") is not None:
                quantity = dec(row["flow_volume_m3"], signed=False)
            else:
                quantity = max(dec(row.get("flow_index_curr"), signed=False) - dec(row.get("flow_index_prev"), signed=False), ZERO)
        return quantize(quantity * price, 2)

    def normalize(self):
        for kind in ("sales", "flows", "receipts", "debts", "intakes"):
            for row in self.collections.get(TABLES[kind], []):
                try:
                    if not active(row, kind):
                        self.excluded[f"{kind}.void"] += 1
                        continue
                    owner = self.owner(row, kind)
                    if owner is None:
                        continue
                    date_value = day(row.get("date" if kind == "sales" else "biz_date"))
                    fact = {"row": row, "id": row["_id"], "owner": owner, "date": date_value}
                    if kind == "sales":
                        for field, calculation in (("weight", self.sale_weight), ("principal", self.sale_principal)):
                            try:
                                fact[field] = calculation(row)
                            except (ValueError, InvalidOperation, TypeError) as error:
                                fact[field] = None
                                self.unknown(f"sales.{field}", str(error), row)
                        mode = text(row.get("biz_mode"))
                        fact["bottles"] = len(row.get("agent_sale_items", [])) if mode == "agent_sale" else len(row.get("out_items", [])) if mode == "bottle" else 0
                    elif kind == "flows":
                        fact["principal"] = money(row.get("should_receive"))
                        try:
                            volume = dec(row.get("flow_volume_m3"), signed=False)
                            price = dec(row.get("unit_price"), signed=False)
                            expected = quantize(volume * price, 3, ROUND_DOWN)
                            self.equal(f"flow.{row['_id']}.should_receive", row.get("should_receive"), expected, "flow_pricing")
                            if row.get("flow_index_prev") is None or row.get("flow_index_curr") is None:
                                raise ValueError("flow_meter_readings_missing")
                            measured = quantize(dec(row["flow_index_curr"], signed=False), 3, ROUND_DOWN) - quantize(dec(row["flow_index_prev"], signed=False), 3, ROUND_DOWN)
                            if measured < 0:
                                raise ValueError("flow_meter_reset_unresolved")
                            self.equal(f"flow.{row['_id']}.flow_volume_m3", volume, quantize(measured, 3, ROUND_DOWN), "flow_pricing")
                        except (ValueError, InvalidOperation) as error:
                            self.unknown("flow_pricing", str(error), row)
                    elif kind == "receipts":
                        fact["amount"] = money(row.get("amount"))
                        fact["cash_kind"] = cash_kind(row)
                        if row.get("receipt_adjustment_status") == "pending" or row.get("refund_source_status") == "pending":
                            self.unknown("receipt_chain", "pending_receipt_operation", row)
                    elif kind == "debts":
                        scale = row.get("money_scale")
                        if scale not in (2, 3):
                            scale = 3 if self.customers[owner].get("default_price_unit") == "m3" else 2
                        fact["principal"] = money(row.get("amount"), digits=scale)
                    self.facts[kind].append(fact)
                except (ValueError, InvalidOperation, TypeError, KeyError) as error:
                    self.unknown(kind, str(error), row)

    def between(self, kind, bounds):
        start, end = day(bounds["start"]), day(bounds["end"])
        return [fact for fact in self.facts[kind] if start <= fact["date"] <= end]

    def scope(self, bounds):
        sales, flows, receipts = (self.between(kind, bounds) for kind in ("sales", "flows", "receipts"))
        principals = [fact["principal"] for fact in sales + flows]
        known_money = all(value is not None for value in principals)
        known_weight = all(fact["weight"] is not None for fact in sales)
        total_sales = sum((fact["principal"] for fact in sales if fact["principal"] is not None), ZERO)
        total_flow = sum((fact["principal"] for fact in flows), ZERO)
        cash = [fact["amount"] for fact in receipts if fact["cash_kind"] == "cash"]
        received, refund = sum((value for value in cash if value >= 0), ZERO), -sum((value for value in cash if value < 0), ZERO)
        settled = {key: ZERO for key in ("principal", "allocated", "sale_rounding", "receipt_rounding", "rounding", "outstanding")}
        settlement_known = known_money
        for fact in sales + flows:
            principal, row = fact["principal"], fact["row"]
            if principal is None or principal <= 0:
                continue
            try:
                own = ZERO if row.get("settlement_mode") == "customer_flow" else money(row.get("rounding_amount"), optional=True, signed=False)
                paid = money(row.get("amount_received"))
                rounded = money(row.get("receipt_rounding_amount"), optional=True, signed=False)
                if paid < 0 or own + paid + rounded > principal:
                    raise ValueError("target_settlement_invalid")
                settled["principal"] += principal
                settled["allocated"] += paid
                settled["sale_rounding"] += own
                settled["receipt_rounding"] += rounded
                settled["outstanding"] += principal - own - paid - rounded
            except (ValueError, InvalidOperation):
                settlement_known = False
        settled["rounding"] = settled["sale_rounding"] + settled["receipt_rounding"]
        return {"business": {"net": total_sales + total_flow if known_money else None,
                             "total": total_sales + total_flow if known_money else None,
                             "sales": total_sales if known_money else None, "flow": total_flow if known_money else None,
                             "positive": sum((value for value in principals if value is not None and value >= 0), ZERO) if known_money else None,
                             "negative": -sum((value for value in principals if value is not None and value < 0), ZERO) if known_money else None,
                             "positive_settlement": settled if settlement_known else {key: None for key in settled}},
                "operations": {"sale_weight_kg": sum((fact["weight"] for fact in sales), ZERO) if known_weight else None,
                               "sale_bottle_count": sum(fact["bottles"] for fact in sales), "customer_count": len({fact["owner"] for fact in sales})},
                "cash": {"received": received, "refund": refund, "net": received - refund},
                "sales": sales, "flows": flows}

    def allocations(self):
        targets = {(kind, fact["id"]): fact for kind in ("sales", "flows", "debts") for fact in self.facts[kind]}
        receipts = {fact["id"]: fact for fact in self.facts["receipts"]}
        by_receipt, by_target = defaultdict(lambda: ZERO), defaultdict(lambda: ZERO)
        for row in self.collections.get(TABLES["allocations"], []):
            try:
                if not active(row, "allocations"):
                    continue
                owner = self.owner(row, "allocations")
                if owner is None:
                    continue
                target_type = text(row.get("target_type")) or ("flow_settlement" if row.get("flow_settlement_id") else "sale")
                kind = {"sale": "sales", "flow_settlement": "flows", "opening_debt": "debts", "other_fee": "debts", "balance_adjustment": "debts"}.get(target_type)
                if not kind:
                    raise ValueError("unsupported_allocation_target")
                target_id = text(row.get("target_id") or (row.get("flow_settlement_id") if kind == "flows" else None) or row.get("sale_id"))
                if row.get("target_id") and row.get("sale_id") and row["target_id"] != row["sale_id"]:
                    raise ValueError("conflicting_allocation_reference")
                target, receipt = targets.get((kind, target_id)), receipts.get(text(row.get("receipt_id")))
                if not target or not receipt or receipt["amount"] <= 0:
                    raise ValueError("missing_allocation_backing")
                if target["owner"] != owner or receipt["owner"] != owner:
                    raise ValueError("cross_customer_allocation")
                reference_source = text(row.get("receipt_source_type"))
                if reference_source and text(receipt["row"].get("source_type")) and reference_source != text(receipt["row"].get("source_type")):
                    raise ValueError("allocation_receipt_source_conflict")
                if reference_source or text(row.get("receipt_entry_kind")):
                    reference_kind = cash_kind({"source_type": reference_source, "entry_kind": row.get("receipt_entry_kind")})
                    if (reference_kind == "offset") != (receipt["cash_kind"] == "offset"):
                        raise ValueError("allocation_receipt_kind_conflict")
                allocate_kind = text(row.get("allocate_kind")) or "receipt"
                if allocate_kind not in {"receipt", "rounding"}:
                    raise ValueError("unsupported_allocation_kind")
                amount = money(row.get("allocate_amount"), signed=False)
                if amount <= 0:
                    raise ValueError("nonpositive_allocation")
                by_receipt[(receipt["id"], allocate_kind)] += amount
                by_target[(kind, target_id, allocate_kind)] += amount
                self.allocation_facts.append({"receipt_id": receipt["id"], "target": target, "type": target_type,
                                              "kind": allocate_kind, "amount": amount})
                self.checks["allocation_relations"] += 1
            except (ValueError, InvalidOperation, KeyError) as error:
                self.unknown("allocation_chain", str(error), row)
        for (kind, identifier), fact in targets.items():
            row, principal = fact["row"], fact["principal"]
            if principal is None:
                continue
            try:
                scale = 2 if kind == "sales" else 3
                received = money(row.get("amount_received"), scale)
                own_rounding = money(row.get("rounding_amount"), scale, optional=True, signed=False)
                rounding = money(row.get("receipt_rounding_amount"), scale, optional=True, signed=False)
                if kind == "flows" and own_rounding:
                    raise ValueError("flow_has_unsupported_source_rounding")
                if principal > 0:
                    effective = principal - own_rounding
                    if received < 0 or received + rounding > effective:
                        raise ValueError("invalid_positive_target_settlement")
                elif principal < 0:
                    effective = principal + own_rounding
                    if received > 0 or received < effective or rounding:
                        raise ValueError("invalid_negative_target_settlement")
                    if received < 0:
                        self.unknown("allocation_chain", "embedded_refund_date_not_proven", row)
                elif received or rounding or own_rounding:
                    raise ValueError("zero_target_has_settlement")
                known = by_target[(kind, identifier, "receipt")]
                if received >= 0:
                    if known != received:
                        self.unknown("allocation_chain", "embedded_or_conflicting_receipt_not_reconciled", row)
                    else:
                        self.checks["target_allocation_totals"] += 1
                self.equal(f"target.{kind}.{identifier}.receipt_rounding_amount", rounding, by_target[(kind, identifier, "rounding")], "target_allocation_totals")
            except (ValueError, InvalidOperation) as error:
                self.unknown("target_settlement", str(error), row)
        refunds = defaultdict(lambda: ZERO)
        for fact in receipts.values():
            row = fact["row"]
            if fact["amount"] >= 0:
                continue
            links = row.get("refund_sources")
            if row.get("source_type") == "offset_credit_cash_refund" and row.get("offset_source_receipt_id"):
                links = [{"id": row["offset_source_receipt_id"], "amount": -fact["amount"]}]
            if not links or row.get("refund_source_status") != "linked":
                self.unknown("receipt_chain", "refund_backing_missing", row)
                continue
            seen, total = set(), ZERO
            for link in links:
                try:
                    identifier = text(link.get("id"))
                    original = receipts.get(identifier)
                    amount = money(link.get("amount"), signed=False)
                    if not original or amount <= 0 or identifier in seen or original["amount"] <= 0 or original["owner"] != fact["owner"] or original["date"] > fact["date"]:
                        raise ValueError("refund_backing_invalid")
                    if original["row"].get("source_type") in {"deposit_transfer", "settlement_fee"}:
                        raise ValueError("refund_backing_nonrefundable")
                    seen.add(identifier)
                    refunds[identifier] += amount
                    total += amount
                except (ValueError, InvalidOperation) as error:
                    self.unknown("receipt_chain", str(error), row)
            self.equal(f"receipt.{fact['id']}.refund_sources", -fact["amount"], total, "refund_chain")
        for fact in receipts.values():
            row, identifier = fact["row"], fact["id"]
            if fact["amount"] < 0:
                continue
            try:
                allocated = money(row.get("allocated_amount"), signed=False)
                remaining = money(row.get("unallocated_amount"), signed=False)
                refunded = money(row.get("offset_cash_refunded_amount" if fact["cash_kind"] == "offset" else "cash_refunded_amount"), optional=True, signed=False)
                rounding = money(row.get("rounding_allocated_amount"), optional=True, signed=False)
                other_refund = money(row.get("cash_refunded_amount" if fact["cash_kind"] == "offset" else "offset_cash_refunded_amount"), optional=True, signed=False)
                if other_refund:
                    raise ValueError("receipt_refund_kind_mismatch")
                self.equal(f"receipt.{identifier}.budget", fact["amount"], allocated + remaining + refunded + (rounding if fact["cash_kind"] == "offset" else ZERO), "receipt_conservation")
                self.equal(f"receipt.{identifier}.allocated_amount", allocated, by_receipt[(identifier, "receipt")], "receipt_conservation")
                self.equal(f"receipt.{identifier}.rounding_allocated_amount", rounding, by_receipt[(identifier, "rounding")], "receipt_conservation")
                self.equal(f"receipt.{identifier}.refunded", refunded, refunds[identifier], "receipt_conservation")
            except (ValueError, InvalidOperation) as error:
                self.unknown("receipt_chain", str(error), row)

    def cashier(self):
        receipts = {fact["id"]: fact for fact in self.facts["receipts"]}
        seen = set()
        for fact in self.facts["intakes"]:
            row = fact["row"]
            try:
                amount = money(row.get("amount"), signed=False)
                gas, deposit = money(row.get("gas_amount"), signed=False), money(row.get("deposit_amount"), signed=False)
                self.equal(f"intake.{fact['id']}.amount", amount, gas + deposit, "cashier_conservation")
                identifier = text(row.get("receipt_id"))
                if not gas:
                    if identifier:
                        raise ValueError("deposit_only_has_gas_receipt")
                    continue
                receipt = receipts.get(identifier)
                if not receipt or identifier in seen:
                    raise ValueError("missing_or_duplicate_cashier_receipt")
                seen.add(identifier)
                source = receipt["row"]
                if source.get("source_type") != "cashier_intake" or source.get("intake_id") != fact["id"] or source.get("source_id") != fact["id"] or receipt["owner"] != fact["owner"] or receipt["date"] != fact["date"] or source.get("purpose") != row.get("purpose") or source.get("payment_method") != row.get("payment_method"):
                    raise ValueError("cashier_receipt_identity_mismatch")
                self.equal(f"intake.{fact['id']}.gas_amount", gas, receipt["amount"], "cashier_conservation")
            except (ValueError, InvalidOperation) as error:
                self.unknown("cashier", str(error), row)
        for fact in self.facts["receipts"]:
            if fact["row"].get("source_type") == "cashier_intake" and fact["id"] not in seen:
                self.unknown("cashier", "receipt_without_cashier_head", fact["row"])

    def destinations(self, bounds):
        keys = ("same_period", "prior_period", "future_period", "other", "refunded_after_or_current",
                "remaining_prepay", "remaining_settlement", "remaining_unknown", "total")
        totals = {key: ZERO for key in keys}
        selected = {fact["id"]: fact for fact in self.between("receipts", bounds)
                    if fact["cash_kind"] == "cash" and fact["amount"] > 0}
        start, end = day(bounds["start"]), day(bounds["end"])
        for allocation in self.allocation_facts:
            if allocation["receipt_id"] not in selected or allocation["kind"] != "receipt":
                continue
            target, target_type = allocation["target"], allocation["type"]
            if target_type == "opening_debt":
                bucket = "prior_period"
            elif target_type in {"sale", "flow_settlement"}:
                bucket = "prior_period" if target["date"] < start else "future_period" if target["date"] > end else "same_period"
            else:
                bucket = "other"
            totals[bucket] += allocation["amount"]
        for fact in selected.values():
            row = fact["row"]
            try:
                purpose = text(row.get("purpose")) or ("prepay" if row.get("source_type") == "customer_prepay_manual" else "unspecified")
                bucket = {"prepay": "remaining_prepay", "settlement": "remaining_settlement", "unspecified": "remaining_unknown"}.get(purpose)
                if not bucket:
                    raise ValueError("unknown_receipt_purpose")
                totals[bucket] += money(row.get("unallocated_amount"), signed=False)
                totals["refunded_after_or_current"] += money(row.get("cash_refunded_amount"), optional=True, signed=False)
                totals["total"] += fact["amount"]
            except (ValueError, InvalidOperation) as error:
                self.unknown("cash_destinations", str(error), row)
        self.equal("cash.destinations.conservation", totals["total"], sum((value for key, value in totals.items() if key != "total"), ZERO), "cash_destinations")
        return totals

    def gas(self):
        bounds = self.bundle["range"]
        channels = {key: {"weight_kg": ZERO, "count": 0} for key in ("bottle", "local", "vehicle", "other")}
        start, end, today = day(bounds["start"]), day(bounds["end"]), day(bounds["today"])
        for row in self.collections.get(TABLES["fillings"], []):
            try:
                raw_date = text(row.get("date"))
                match = re.fullmatch(r"(\d{4}-\d{2}-\d{2})(?:-(\d{2})(?:-(\d{2})(?:-(\d{2}))?)?)?", raw_date)
                if not match:
                    raise ValueError("invalid_gas_business_date")
                raw_day = match[1]
                value_day = day(raw_day)
                if not start <= value_day <= end:
                    continue
                timing = text(row.get("filling_time")) or raw_date
                time_match = re.fullmatch(r"(\d{4}-\d{2}-\d{2})(?:-(\d{2})(?:-(\d{2})(?:-(\d{2}))?)?)?", timing)
                if not time_match or time_match[1] != raw_day or any(int(time_match[index] or 0) > maximum for index, maximum in ((2, 23), (3, 59), (4, 59))):
                    raise ValueError("invalid_gas_business_time")
                if not time_match[2] and row.get("ended_at") is not None:
                    timestamp = dec(row["ended_at"], signed=False)
                    if timestamp <= 0 or timestamp != timestamp.to_integral_value() or datetime.fromtimestamp(float(timestamp) / 1000, timezone(timedelta(hours=8))).date() != value_day:
                        raise ValueError("gas_end_time_date_mismatch")
                if value_day == today:
                    raise ValueError("current_day_gas_time_replay_not_supported")
                weight = dec(row.get("fill_weight"), signed=False)
                bottle = re.sub(r"\s", "", text(row.get("bottle_no"))).upper()
                record_type = text(row.get("record_type")).lower()
                key = "vehicle" if record_type == "truck_out_no_sale" else "local" if bottle == "000" else "bottle" if bottle and not bottle.startswith("TRUCK") and record_type in {"", "normal_fill", "truck_out_agent_sale"} else "other"
                channels[key]["weight_kg"] += quantize(weight, 3)
                channels[key]["count"] += int(weight > 0)
                self.checks["gas_source_rows"] += 1
            except (ValueError, InvalidOperation) as error:
                self.unknown("gas_outflow", str(error), row)
        return {"weight_kg": sum((row["weight_kg"] for row in channels.values()), ZERO),
                "channels": [{"key": key, **row} for key, row in channels.items()]}

    def analysis(self):
        today = day(self.bundle["range"]["today"])
        trend_range = {"start": (today - timedelta(days=7)).isoformat(), "end": (today - timedelta(days=1)).isoformat()}
        points = []
        for offset in range(7, 0, -1):
            d = (today - timedelta(days=offset)).isoformat()
            scoped = self.scope({"start": d, "end": d})
            value = scoped["operations"]["sale_weight_kg"]
            points.append({"date": d, "value": value, "status": "available" if value is not None else "unavailable", "source_count": len(scoped["sales"])})
        period = self.bundle.get("period", "yesterday")
        current_range, baseline_range = None, None
        if period == "yesterday":
            current_range = {"start": (today - timedelta(days=1)).isoformat(), "end": (today - timedelta(days=1)).isoformat()}
            baseline_range = {"start": (today - timedelta(days=2)).isoformat(), "end": (today - timedelta(days=2)).isoformat()}
        elif period == "month":
            prior = today.replace(day=1) - timedelta(days=1)
            n = min(today.day - 1, calendar.monthrange(prior.year, prior.month)[1])
            if n:
                current_range = {"start": today.replace(day=1).isoformat(), "end": today.replace(day=n).isoformat()}
                baseline_range = {"start": prior.replace(day=1).isoformat(), "end": prior.replace(day=n).isoformat()}
        elif period != "today":
            self.unknown("comparison", "unsupported_period")
        metrics, driver_rows = {}, []
        if current_range:
            current, baseline = self.scope(current_range), self.scope(baseline_range)
            for name, section, field in (("sale_weight_kg", "operations", "sale_weight_kg"), ("business_net", "business", "net"), ("cash_net", "cash", "net"), ("customer_count", "operations", "customer_count")):
                a, b = current[section][field], baseline[section][field]
                valid = a is not None and b is not None
                delta = dec(a) - dec(b) if valid else None
                metrics[name] = {"status": "available" if valid else "unavailable", "current": a, "baseline": b, "delta": delta,
                                 "rate": delta / dec(b) if valid and dec(b) > 0 else None}
            customers = defaultdict(lambda: {"current": ZERO, "baseline": ZERO})
            for label, scoped in (("current", current), ("baseline", baseline)):
                for fact in scoped["sales"] + scoped["flows"]:
                    if fact["principal"] is not None:
                        customers[fact["owner"]][label] += fact["principal"]
            for identifier, totals in customers.items():
                delta = totals["current"] - totals["baseline"]
                if delta:
                    driver_rows.append({"customer_id": identifier, **totals, "delta": delta})
            driver_rows.sort(key=lambda row: (-abs(row["delta"]), row["customer_id"]))
        return {"trend": {"range": trend_range, "points": points},
                "comparison": {"current_range": current_range, "baseline_range": baseline_range, "metrics": metrics},
                "drivers": {"items": driver_rows[:3], "other_delta": sum((row["delta"] for row in driver_rows[3:]), ZERO),
                            "total_delta": sum((row["delta"] for row in driver_rows), ZERO)}}

    def compare_expected(self, actual, expected, path=""):
        # Only explicitly supported public numerical claims are accepted below.
        # Metadata, prose, and internal states are not certified by this replay.
        if isinstance(actual, dict) and isinstance(expected, dict):
            for key in expected:
                if key not in actual:
                    self.ignored_expected_paths.append(f"{path}.{key}".lstrip("."))
            for key, value in actual.items():
                if key in expected:
                    self.compare_expected(value, expected[key], f"{path}.{key}".lstrip("."))
        elif isinstance(actual, list) and isinstance(expected, list):
            self.equal(f"{path}.length", len(expected), len(actual))
            for index, (value, observed) in enumerate(zip(actual, expected)):
                self.compare_expected(value, observed, f"{path}[{index}]")
        elif path.endswith(".rate") and actual is not None and expected is not None:
            # Rate is a binary JS division in the response. Values/denominators
            # above must agree exactly; allow only representation error here.
            self.checks["expected"] += 1
            self.expected_checks += 1
            self.expected_paths.append(path)
            try:
                if abs(dec(expected) - actual) > Decimal("0.000000000001"):
                    self.differences.append({"path": path, "observed": expected, "computed": actual})
            except ValueError:
                self.differences.append({"path": path, "observed": expected, "computed": actual})
        else:
            self.equal(path, expected, actual)

    def run(self):
        self.integrity()
        try:
            bounds = self.bundle["range"]
            if day(bounds["start"]) > day(bounds["end"]) or day(bounds["end"]) > day(bounds["today"]):
                raise ValueError("invalid_range")
        except (KeyError, TypeError, ValueError):
            self.unknown("integrity", "invalid_range")
            return self.report()
        self.normalize()
        self.allocations()
        self.cashier()
        current = self.scope(bounds)
        self.derived = {key: current[key] for key in ("business", "operations", "cash")}
        self.derived["cash"]["destinations"] = self.destinations(bounds)
        self.derived["analysis"] = self.analysis()
        self.derived["outflow"] = self.gas()
        for channel in self.derived["outflow"]["channels"]:
            prefix = "fill_bottle" if channel["key"] == "bottle" else channel["key"]
            self.derived["operations"][f"{prefix}_weight_kg"] = channel["weight_kg"]
            self.derived["operations"][f"{prefix}_count"] = channel["count"]
        self.derived["operations"]["recorded_outflow_kg"] = self.derived["outflow"]["weight_kg"]
        expected = self.bundle.get("expected")
        if not isinstance(expected, dict) or not expected:
            self.unknown("expected", "missing_displayed_results")
        else:
            for key in expected:
                if key not in self.derived:
                    self.unknown("expected", "unsupported_result_section", field=key)
            self.compare_expected(self.derived, expected)
        if not self.expected_checks:
            self.unknown("expected", "no_supported_claims_compared")
        return self.report()

    def report(self):
        return {"version": VERSION, "complete": not self.differences and not self.unsupported and self.expected_checks > 0,
                "basis": "independent_decimal_replay_of_provided_raw_records",
                "bundle_digest": digest(self.bundle), "differences": self.differences,
                "unsupported": self.unsupported, "coverage": {"checks": dict(self.checks), "excluded": dict(self.excluded),
                    "expected_claims_checked": self.expected_checks,
                    "expected_paths": self.expected_paths, "not_compared_expected_paths": self.ignored_expected_paths,
                    "limits": ["Source hashes detect changes; they do not prove authenticity or all business was registered.",
                               "No bank/payment settlement, physical inventory, calibration, real loss or atomic-snapshot certification.",
                               "Current-day gas business-time filtering and tank-level conversion are outside this independent replay.",
                               "Decimal half-up (sales) and truncation (flow) expose binary rounding differences; such differences require review.",
                               "Legacy embedded receipts without a complete allocation chain remain unverified, never assumed wrong or zero."]},
                "computed": self.derived}


def json_safe(value):
    if isinstance(value, Decimal):
        return str(value)
    if isinstance(value, dict):
        return {key: json_safe(item) for key, item in value.items()}
    if isinstance(value, list):
        return [json_safe(item) for item in value]
    return value


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("bundle", help="JSON evidence path, or '-' for stdin")
    parser.add_argument("--seal", action="store_true", help="output hashes only; does not verify claims or declare complete reads")
    args = parser.parse_args()
    try:
        source = sys.stdin.read() if args.bundle == "-" else open(args.bundle, encoding="utf-8").read()
        bundle = json.loads(source, parse_constant=lambda value: (_ for _ in ()).throw(ValueError("nonfinite JSON")))
        if not isinstance(bundle, dict):
            raise ValueError("bundle must be an object")
        result = seal(bundle) if args.seal else Replay(bundle).run()
        print(json.dumps(json_safe(result), ensure_ascii=False, indent=2, allow_nan=False))
        return 0 if args.seal or result["complete"] else 1
    except (OSError, ValueError, TypeError, KeyError, InvalidOperation) as error:
        print(json.dumps({"version": VERSION, "complete": False, "error": str(error)}, ensure_ascii=False))
        return 2


if __name__ == "__main__":
    sys.exit(main())
