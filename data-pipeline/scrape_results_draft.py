"""Draft election results from Wikipedia, for a human to review. LOCAL ONLY.

This never runs in CI and never writes the curated file on its own. It reads
the `{{Infobox election}}` of each state's article ("2026 United States House of
Representatives elections in {State}"; "election in" for the six at-large
states) through the MediaWiki API, and writes a DRAFT in the curated-results
format to data-pipeline/results/drafts/ (gitignored), with a diff against the
curated file. Wikipedia is community-edited and lags during the count: treat
every number as a lead to check, fill gaps from state election offices, and
commit only what you've looked at.

    python data-pipeline/scrape_results_draft.py                 # draft + diff
    python data-pipeline/scrape_results_draft.py --apply CA,TX   # copy those states' votes
                                                                 # and seats into the curated CSV

--apply copies vote totals, source_url and as_of for the named states and marks
them provisional. It never marks a state certified (that needs the state's
certification as the source) and refuses to touch a certified row.
Review with `git diff`, then `python data-pipeline/build_results.py --check`.

Seat calls are NOT drafted while a state is still counting. Before the election
many articles pre-fill each party's `seatsN` from the last election, and during
the count those numbers lag the race calls, so an infobox seat figure can't be
told apart from a call. Seats are taken only from a finished article
(`ongoing` not "yes") that has vote totals; otherwise the curated file's seat
calls, entered by hand from race calls, are kept.

Provenance: each row's source_url is the permalink of the exact article
revision read (?oldid=), and as_of is that revision's timestamp.
"""

from __future__ import annotations

import csv
import re
import sys
from datetime import datetime, timezone
from pathlib import Path

import requests

import election
from fetch_clerk_house import STATE_CODES, parse_house_composition
from results_file import APPORTIONMENT, COLUMNS, ResultsFileError, parse_rows

REPO_ROOT = Path(__file__).resolve().parent.parent
DRAFTS_DIR = REPO_ROOT / "data-pipeline" / "results" / "drafts"
API = "https://en.wikipedia.org/w/api.php"
USER_AGENT = "ProportionalHouse/1.0 (https://proportionalhouse.org; election results draft)"
_CODE_TO_NAME = {code: name for name, code in STATE_CODES.items()}

# A share move this large between the curated file and the draft is flagged.
SHARE_MOVE_FLAG = 0.05


def article_title(cycle: int, name: str, seats: int) -> str:
    kind = "election" if seats == 1 else "elections"
    return f"{cycle} United States House of Representatives {kind} in {name}"


def fetch_revisions(titles: list[str]) -> dict[str, dict]:
    """title → {text, revid, timestamp} for each title that exists (redirects followed)."""
    out: dict[str, dict] = {}
    for i in range(0, len(titles), 50):
        batch = titles[i:i + 50]
        params = {
            "action": "query", "prop": "revisions", "rvprop": "content|ids|timestamp",
            "rvslots": "main", "redirects": 1, "format": "json", "formatversion": 2,
            "titles": "|".join(batch),
        }
        while True:
            r = requests.get(API, params=params, headers={"User-Agent": USER_AGENT}, timeout=30)
            r.raise_for_status()
            data = r.json()
            q = data.get("query", {})
            # Map a redirect target back to the title we asked for.
            back = {d["to"]: d["from"] for d in q.get("redirects", [])}
            back.update({d["to"]: d["from"] for d in q.get("normalized", [])})
            for page in q.get("pages", []):
                revs = page.get("revisions")
                if page.get("missing") or not revs:
                    continue
                rev = revs[0]
                asked = back.get(page["title"], page["title"])
                out[asked] = {
                    "text": rev["slots"]["main"]["content"],
                    "revid": rev["revid"],
                    "timestamp": rev["timestamp"],
                }
            if "continue" not in data:
                break
            params = {**params, **data["continue"]}
    return out


def extract_infobox(wikitext: str) -> dict[str, str] | None:
    """The article's first {{Infobox election}} as {param: raw value}."""
    start = wikitext.find("{{Infobox election")
    if start < 0:
        return None
    depth, i, end = 0, start, None
    while i < len(wikitext) - 1:
        pair = wikitext[i:i + 2]
        if pair == "{{":
            depth += 1; i += 2; continue
        if pair == "}}":
            depth -= 1; i += 2
            if depth == 0:
                end = i
                break
            continue
        i += 1
    if end is None:
        return None
    body = wikitext[start + 2:end - 2]
    # Split on pipes at nesting depth 0 (not inside [[…]] or {{…}}).
    parts, buf, curly, square, j = [], [], 0, 0, 0
    while j < len(body):
        two = body[j:j + 2]
        if two in ("{{", "}}", "[[", "]]"):
            curly += (two == "{{") - (two == "}}")
            square += (two == "[[") - (two == "]]")
            buf.append(two); j += 2; continue
        ch = body[j]
        if ch == "|" and curly == 0 and square == 0:
            parts.append("".join(buf)); buf = []
        else:
            buf.append(ch)
        j += 1
    parts.append("".join(buf))
    params: dict[str, str] = {}
    for part in parts[1:]:  # parts[0] is "Infobox election"
        if "=" in part:
            k, v = part.split("=", 1)
            params[k.strip()] = v.strip()
    return params


def clean(value: str) -> str:
    v = re.sub(r"<!--.*?-->", "", value, flags=re.S)
    v = re.sub(r"<ref[^>]*/>", "", v)
    v = re.sub(r"<ref[^>]*>.*?</ref>", "", v, flags=re.S)
    v = re.sub(r"\[\[(?:[^|\]]*\|)?([^\]]*)\]\]", r"\1", v)
    v = re.sub(r"\{\{[^{}]*\}\}", "", v)
    return v.replace("'''", "").replace("''", "").strip()


def to_int(value: str | None) -> int | None:
    if value is None:
        return None
    v = clean(value).replace(",", "")
    return int(v) if re.fullmatch(r"\d+", v) else None


def party_bucket(name: str) -> str:
    """'Minnesota Democratic–Farmer–Labor Party' → D, 'Republican Party of Minnesota' → R."""
    n = clean(name)
    if "Democratic" in n:
        return "D"
    if "Republican" in n:
        return "R"
    return "O"


def draft_row(code: str, info: dict[str, str] | None, rev: dict | None) -> dict:
    """One curated-format row from a state's infobox. Pending when nothing's counted."""
    row = {c: "" for c in COLUMNS} | {"code": code, "status": "pending"}
    if not info or not rev:
        row["note"] = "draft: no article or infobox found"
        return row
    votes = {"D": 0, "R": 0, "O": 0}
    seats = {"D": 0, "R": 0, "O": 0}
    any_votes = False
    for n in range(1, 10):
        party = info.get(f"party{n}")
        if not party:
            continue
        b = party_bucket(party)
        v = to_int(info.get(f"popular_vote{n}"))
        if v:
            votes[b] += v
            any_votes = True
        s = to_int(info.get(f"seats{n}"))
        if s:
            seats[b] += s
    ongoing = clean(info.get("ongoing", "")).lower()
    # At-large articles list nominees, not seats: the winner is after_party,
    # which editors fill in once the race is called.
    if APPORTIONMENT[code] == 1 and not any(seats.values()) and info.get("after_party") and ongoing != "yes":
        seats[party_bucket(info["after_party"])] = 1
    # Seats only from a finished article with results in (see module doc):
    # pre-election and mid-count, seatsN can be last cycle's numbers.
    seats_trusted = any_votes and ongoing != "yes"
    if not seats_trusted:
        seats = {"D": 0, "R": 0, "O": 0}
    if any_votes:
        row.update({
            "status": "provisional",
            "d_votes": votes["D"], "r_votes": votes["R"],
            "other_votes": votes["O"] if votes["O"] else "",
            "source_url": f"https://en.wikipedia.org/w/index.php?oldid={rev['revid']}",
            "as_of": rev["timestamp"],
        })
    if seats_trusted:
        row.update({"d_seats": seats["D"], "r_seats": seats["R"], "other_seats": seats["O"] or ""})
    row["note"] = (
        "draft: Wikipedia infobox, finished" if seats_trusted
        else "draft: Wikipedia infobox, votes only (seat calls not taken while counting)"
    )
    # Strings throughout, exactly as the curated CSV holds them.
    return {k: "" if v is None else str(v) for k, v in row.items()}


def read_curated(path: Path) -> dict[str, dict]:
    with path.open(newline="", encoding="utf-8") as f:
        return {r["code"]: r for r in csv.DictReader(f)}


def _num(v) -> int:
    try:
        return int(str(v).replace(",", "") or 0)
    except ValueError:
        return 0


def diff(curated: dict[str, dict], draft: list[dict], per_state: dict | None) -> list[str]:
    lines = []
    for d in draft:
        c = curated.get(d["code"], {})
        code = d["code"]
        cd, cr = _num(c.get("d_votes")), _num(c.get("r_votes"))
        dd, dr = _num(d["d_votes"]), _num(d["r_votes"])
        flags = []
        if dd < cd or dr < cr:
            flags.append("VOTES FELL")
        if cd + cr and dd + dr and abs(dd / (dd + dr) - cd / (cd + cr)) > SHARE_MOVE_FLAG:
            flags.append(f"SHARE MOVED >{SHARE_MOVE_FLAG:.0%}")
        if per_state and code in per_state:
            ps = per_state[code]
            if (_num(d["d_seats"]), _num(d["r_seats"])) != (ps["d_seats"], ps["r_seats"]):
                flags.append(f"SEATS ≠ main-article table (D {ps['d_seats']} / R {ps['r_seats']})")
        has_seats = any(d[k] != "" for k in ("d_seats", "r_seats", "other_seats"))
        seats_changed = has_seats and (_num(c.get("d_seats")), _num(c.get("r_seats"))) != (_num(d["d_seats"]), _num(d["r_seats"]))
        changed = (cd, cr) != (dd, dr) or seats_changed
        if changed or flags:
            lines.append(
                f"  {code}: votes D {cd:,}→{dd:,} R {cr:,}→{dr:,} · seats D {_num(c.get('d_seats'))}→{_num(d['d_seats'])} "
                f"R {_num(c.get('r_seats'))}→{_num(d['r_seats'])}" + (f"   ⚠ {', '.join(flags)}" if flags else "")
            )
    return lines


def apply(curated_path: Path, draft: list[dict], codes: list[str]) -> None:
    curated = read_curated(curated_path)
    by_code = {d["code"]: d for d in draft}
    for code in codes:
        if code not in by_code:
            print(f"  skip {code}: not in the draft")
            continue
        if curated[code].get("status") == "certified":
            print(f"  skip {code}: already certified — edit by hand if the certification changed")
            continue
        d = by_code[code]
        if d["status"] == "pending":
            print(f"  skip {code}: the draft has no votes for it")
            continue
        for k in ("d_votes", "r_votes", "other_votes", "source_url", "as_of"):
            curated[code][k] = d[k]
        # Seat calls only when the draft has them (a finished article);
        # otherwise the hand-entered calls stay.
        if any(d[k] != "" for k in ("d_seats", "r_seats", "other_seats")):
            for k in ("d_seats", "r_seats", "other_seats"):
                curated[code][k] = d[k]
        curated[code]["status"] = "provisional"
        print(f"  applied {code}")
    rows = [curated[c] for c in sorted(curated)]
    parse_rows(rows)  # refuse to write a file that won't validate
    with curated_path.open("w", newline="", encoding="utf-8") as f:
        w = csv.DictWriter(f, fieldnames=COLUMNS)
        w.writeheader()
        w.writerows(rows)
    shown = curated_path.relative_to(REPO_ROOT) if curated_path.is_relative_to(REPO_ROOT) else curated_path
    print(f"Updated {shown} — review with `git diff`.")


def main(argv: list[str]) -> int:
    el = election.resolve()
    titles = {code: article_title(el.cycle, _CODE_TO_NAME[code], seats) for code, seats in APPORTIONMENT.items()}
    main_title = f"{el.cycle} United States House of Representatives elections"
    print(f"Fetching {len(titles)} state articles + '{main_title}' from Wikipedia …")
    revs = fetch_revisions(list(titles.values()) + [main_title])

    draft = [draft_row(code, extract_infobox(revs[t]["text"]) if t in revs else None, revs.get(t))
             for code, t in sorted(titles.items())]
    per_state = None
    if main_title in revs:
        try:
            per_state = parse_house_composition(revs[main_title]["text"], allow_uncalled=True)
        except RuntimeError as e:
            print(f"  (note) main-article 'Per state' table unusable for the seat cross-check: {e}")

    try:
        parse_rows(draft)
    except ResultsFileError as e:
        print("⚠ the draft itself has problems (fix by hand before applying):\n  " + str(e).replace("\n", "\n  "))

    DRAFTS_DIR.mkdir(parents=True, exist_ok=True)
    out = DRAFTS_DIR / f"house_{el.cycle}_draft_{datetime.now(timezone.utc):%Y%m%dT%H%M%SZ}.csv"
    with out.open("w", newline="", encoding="utf-8") as f:
        w = csv.DictWriter(f, fieldnames=COLUMNS)
        w.writeheader()
        w.writerows(draft)
    n_prov = sum(1 for d in draft if d["status"] == "provisional")
    print(f"Wrote {out.relative_to(REPO_ROOT)} ({n_prov} states with votes).")

    changes = diff(read_curated(el.results_csv), draft, per_state)
    print("Draft vs. curated:" if changes else "Draft matches the curated file.")
    print("\n".join(changes))

    if "--apply" in argv:
        codes = argv[argv.index("--apply") + 1].upper().split(",") if len(argv) > argv.index("--apply") + 1 else []
        apply(el.results_csv, draft, [c.strip() for c in codes if c.strip()])
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
