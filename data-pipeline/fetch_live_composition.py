"""Live U.S. House composition — today's chamber, including vacancies.

Source: the Clerk of the House's official member list,
https://clerk.house.gov/xml/lists/MemberData.xml

WHY THIS EXISTS, and how it differs from fetch_clerk_house.py:

  fetch_clerk_house.py produces the November 2024 *election result* — a complete
  435-seat partition that never changes. That stays the projection baseline: the
  site's headline compares "what winner-take-all districts produced" against
  "what proportional representation of the same votes would produce", and both
  sides of that comparison have to describe the same election. If a member
  resigns, the seat-gap must not move — that would attribute attrition to the
  electoral system.

  This module produces the *live* chamber, which does move: special elections,
  resignations, deaths, party switches. It is display-only. Nothing in the
  allocation math reads it.

Two details the Clerk feed gets right and a naive parse gets wrong:

  * Vacant seats are still present as <member> entries — with empty name/party
    and a <footnote> giving the reason — so the 435-district structure is never
    lost and vacancies come with a citable cause.
  * <party> and <caucus> can differ. CA-03 (Kiley) is party="I", caucus="R".
    Chamber composition follows the caucus, so counting <party> would misreport
    the totals.

The feed also carries six non-voting delegates (DC, PR, GU, VI, AS as "AQ", MP);
they are filtered out.
"""

from __future__ import annotations

import xml.etree.ElementTree as ET
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

import requests

from fetch_clerk_house import SEATS_2024, STATES_TO_FIPS, STATE_CODES
from io_utils import write_json_atomic

REPO_ROOT = Path(__file__).resolve().parent.parent
OUT_PATH = REPO_ROOT / "public" / "data" / "house_composition.json"

MEMBER_DATA_URL = "https://clerk.house.gov/xml/lists/MemberData.xml"

TOTAL_SEATS = 435

# Postal code -> full name, inverted from the shared table so we can key off the
# Clerk's `<state postal-code="…">` attribute.
_CODE_TO_NAME = {code: name for name, code in STATE_CODES.items()}


def _text(node: ET.Element | None, path: str) -> str:
    if node is None:
        return ""
    return (node.findtext(path) or "").strip()


def parse_member_data(xml_text: str) -> dict[str, Any]:
    """Parse the Clerk member list into a per-state composition payload.

    Raises rather than returning a partial chamber: publishing "the House has
    431 seats" because a fetch was truncated would be worse than publishing
    nothing.
    """
    root = ET.fromstring(xml_text)

    congress_raw = _text(root, ".//congress-num")
    publish_date = (root.get("publish-date") or "").strip()

    by_state: dict[str, dict[str, int]] = {
        code: {"d_seats": 0, "r_seats": 0, "other_seats": 0, "vacant": 0}
        for code in SEATS_2024
    }
    vacancies: list[dict[str, str]] = []
    seen_districts = 0

    for member in root.findall(".//member"):
        info = member.find("member-info")
        state_el = info.find("state") if info is not None else None
        code = (state_el.get("postal-code") if state_el is not None else "") or ""
        code = code.strip().upper()
        # Non-voting delegates (DC, PR, GU, VI, AQ, MP) are not House seats.
        if code not in by_state:
            continue
        seen_districts += 1

        district = _text(info, "district") or (member.findtext("statedistrict") or "")[2:]
        # Caucus, not party: they differ for members who sit as independents.
        caucus = _text(info, "caucus") or _text(info, "party")
        name = _text(info, "namelist")

        if not caucus and not name:
            by_state[code]["vacant"] += 1
            reason = _text(info, "footnote")
            vacancies.append(
                {
                    "code": code,
                    "name": _CODE_TO_NAME[code],
                    "district": district,
                    "reason": reason,
                }
            )
        elif caucus == "D":
            by_state[code]["d_seats"] += 1
        elif caucus == "R":
            by_state[code]["r_seats"] += 1
        else:
            by_state[code]["other_seats"] += 1

    # --- Validation: refuse to publish anything that isn't a whole chamber ----
    if seen_districts != TOTAL_SEATS:
        raise RuntimeError(
            f"Clerk member list covered {seen_districts} state districts, expected {TOTAL_SEATS} "
            "(feed truncated or apportionment changed?)"
        )
    for code, counts in by_state.items():
        total = sum(counts.values())
        if total != SEATS_2024[code]:
            raise RuntimeError(
                f"{code}: Clerk list has {total} districts, apportionment says {SEATS_2024[code]}"
            )
    national = {
        "d_seats": sum(v["d_seats"] for v in by_state.values()),
        "r_seats": sum(v["r_seats"] for v in by_state.values()),
        "other_seats": sum(v["other_seats"] for v in by_state.values()),
        "vacant": sum(v["vacant"] for v in by_state.values()),
        "total_seats": TOTAL_SEATS,
    }
    if national["d_seats"] + national["r_seats"] + national["other_seats"] + national["vacant"] != TOTAL_SEATS:
        raise RuntimeError(f"national composition does not sum to {TOTAL_SEATS}: {national}")
    if len(vacancies) != national["vacant"]:
        raise RuntimeError(
            f"vacancy list has {len(vacancies)} entries but {national['vacant']} seats are vacant"
        )
    missing_reason = [f"{v['code']}-{v['district']}" for v in vacancies if not v["reason"]]
    if missing_reason:
        # A vacancy with no stated cause is an unexplained number; the Clerk
        # always supplies one, so its absence means the parse or the feed drifted.
        raise RuntimeError(f"vacancies with no stated reason: {', '.join(missing_reason)}")

    states = [
        {
            "code": code,
            "fips": STATES_TO_FIPS[_CODE_TO_NAME[code]],
            "name": _CODE_TO_NAME[code],
            "seats": SEATS_2024[code],
            **by_state[code],
        }
        for code in sorted(by_state)
    ]

    return {
        "meta": {
            "generated_at": datetime.now(timezone.utc).isoformat(),
            "congress": int(congress_raw) if congress_raw.isdigit() else None,
            "publish_date": publish_date,
            "source": "Clerk of the U.S. House, MemberData.xml",
            "source_url": MEMBER_DATA_URL,
            "note": (
                "Live chamber composition, including vacancies. Party attribution follows "
                "each member's caucus. Distinct from the November 2024 election result, "
                "which remains the projection baseline — see house_2024.json."
            ),
        },
        "national": national,
        "states": states,
        "vacancies": vacancies,
    }


def fetch_live_composition() -> dict[str, Any]:
    print(f"Fetching {MEMBER_DATA_URL}")
    r = requests.get(
        MEMBER_DATA_URL,
        headers={"User-Agent": "the-proportional-house/1.0 (+https://proportionalhouse.org)"},
        timeout=60,
    )
    r.raise_for_status()
    return parse_member_data(r.text)


def main() -> None:
    payload = fetch_live_composition()
    write_json_atomic(OUT_PATH, payload)
    n = payload["national"]
    print(
        f"Wrote {OUT_PATH.relative_to(REPO_ROOT)}: "
        f"D {n['d_seats']} / R {n['r_seats']}"
        + (f" / other {n['other_seats']}" if n["other_seats"] else "")
        + f" / {n['vacant']} vacant (as of {payload['meta']['publish_date']})"
    )
    for v in payload["vacancies"]:
        print(f"    vacant: {v['code']}-{v['district']} — {v['reason']}")


if __name__ == "__main__":
    main()
