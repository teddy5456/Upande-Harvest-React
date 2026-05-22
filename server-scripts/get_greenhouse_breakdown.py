# Frappe Server Script — paste into:
#   Desk → Server Script → New
#   Script Type:  API
#   API Method:   get_greenhouse_breakdown
#   Allow Guest:  No
#
# Returns per-greenhouse harvest stems, received stems, and the variety
# breakdown for the dashboard "Greenhouses" card.
#
# Request:  POST /api/method/get_greenhouse_breakdown
#           { "from_date": "YYYY-MM-DD", "to_date": "YYYY-MM-DD" }   (both optional, default = today)
#
# Response: { "message": [ { greenhouse, greenhouse_name, harvested_stems,
#                            received_stems, variety_count, varieties: [{item_code, stems}, ...] } ] }

try:
    data = frappe.form_dict
    today = frappe.utils.nowdate()
    from_date = data.get("from_date") or today
    to_date = data.get("to_date") or today

    # ── Harvest by (greenhouse, item_code) ────────────────────────────────────
    harvest_rows = frappe.db.sql(
        """
        SELECT
            COALESCE(se.custom_greenhouse, 'Unknown') AS greenhouse,
            w.warehouse_name                          AS greenhouse_name,
            sed.item_code                             AS item_code,
            COALESCE(SUM(sed.qty), 0)                 AS stems
        FROM `tabStock Entry` se
        JOIN `tabStock Entry Detail` sed ON sed.parent = se.name
        LEFT JOIN `tabWarehouse` w ON w.name = se.custom_greenhouse
        WHERE se.stock_entry_type = 'Harvesting'
          AND se.docstatus != 2
          AND se.posting_date BETWEEN %(fd)s AND %(td)s
          AND IFNULL(se.custom_greenhouse, '') != ''
        GROUP BY se.custom_greenhouse, w.warehouse_name, sed.item_code
        ORDER BY stems DESC
        """,
        {"fd": from_date, "td": to_date},
        as_dict=True,
    )

    # ── Received stems per greenhouse ─────────────────────────────────────────
    # Receiving Stock Entries are linked to the originating bucket via
    # custom_bucket_id; greenhouse is recovered from the matching Harvesting
    # entry. Pre-aggregating bucket→greenhouse avoids double-counting if a
    # bucket somehow has multiple harvest rows.
    received_rows = frappe.db.sql(
        """
        SELECT
            COALESCE(h.greenhouse, 'Unknown') AS greenhouse,
            COALESCE(SUM(rd.qty), 0)          AS stems
        FROM `tabStock Entry` r
        JOIN `tabStock Entry Detail` rd ON rd.parent = r.name
        LEFT JOIN (
            SELECT custom_bucket_id,
                   MAX(custom_greenhouse) AS greenhouse
            FROM `tabStock Entry`
            WHERE stock_entry_type = 'Harvesting'
              AND docstatus = 1
              AND IFNULL(custom_bucket_id, '') != ''
            GROUP BY custom_bucket_id
        ) h ON h.custom_bucket_id = r.custom_bucket_id
        WHERE r.stock_entry_type = 'Receiving'
          AND r.docstatus = 1
          AND r.posting_date BETWEEN %(fd)s AND %(td)s
        GROUP BY h.greenhouse
        """,
        {"fd": from_date, "td": to_date},
        as_dict=True,
    )

    received_map = {row["greenhouse"]: float(row["stems"] or 0) for row in received_rows}

    # ── Merge into the response shape ────────────────────────────────────────
    by_gh = {}
    for r in harvest_rows:
        gh = r["greenhouse"]
        bucket = by_gh.setdefault(gh, {
            "greenhouse": gh,
            "greenhouse_name": r.get("greenhouse_name") or gh,
            "harvested_stems": 0.0,
            "received_stems": float(received_map.get(gh, 0)),
            "variety_count": 0,
            "varieties": [],
        })
        stems = float(r["stems"] or 0)
        bucket["harvested_stems"] += stems
        bucket["varieties"].append({
            "item_code": r["item_code"],
            "stems": stems,
        })

    # Greenhouses that received but had no harvest in range still get a row
    for gh, stems in received_map.items():
        if gh not in by_gh:
            by_gh[gh] = {
                "greenhouse": gh,
                "greenhouse_name": gh,
                "harvested_stems": 0.0,
                "received_stems": stems,
                "variety_count": 0,
                "varieties": [],
            }

    result = []
    for bucket in by_gh.values():
        bucket["variety_count"] = len(bucket["varieties"])
        result.append(bucket)

    result.sort(key=lambda b: b["harvested_stems"], reverse=True)

    frappe.response["message"] = result
    frappe.response["http_status_code"] = 200

except Exception:
    import traceback
    frappe.log_error(
        title="get_greenhouse_breakdown error",
        message=traceback.format_exc(),
    )
    frappe.response["http_status_code"] = 500
    frappe.response["error"] = "Internal Server Error"
