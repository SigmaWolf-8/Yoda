"""Server-rendered operator review; no browser-provided deletion paths."""
import html
import json
from urllib.parse import urlencode
from retention_store import PAGE_SIZE


def esc(value):
    return html.escape(str(value), quote=True)


def page(title, body):
    return f"""<!doctype html><html lang="en"><meta charset="utf-8">
    <meta name="viewport" content="width=device-width,initial-scale=1">
    <title>{esc(title)} · Yoda archive</title>
    <style>body{{background:#12110f;color:#eee;font:16px system-ui;max-width:1100px;margin:30px auto;padding:20px}}
    a{{color:#e7bc72}}table{{width:100%;border-collapse:collapse}}th,td{{text-align:left;padding:12px;border-bottom:1px solid #555;overflow-wrap:anywhere}}
    button,input{{font:inherit;padding:10px}}button{{cursor:pointer}}pre{{white-space:pre-wrap;overflow-wrap:anywhere}}
    .scroll{{overflow:auto}}code{{overflow-wrap:anywhere}}label{{display:block;margin:15px 0}}</style>
    <a href="/">Archive home</a> · <a href="/retention">Retention</a>
    <h1>{esc(title)}</h1>{body}</html>""".encode()


def bytes_text(value):
    return "unavailable" if value is None else f"{value:,} bytes"


def pager(path, params, number, count):
    pages = max(1, (count + PAGE_SIZE - 1) // PAGE_SIZE)
    if number < 0 or number >= pages:
        raise ValueError("Page outside this snapshot")
    links = []
    for label, target in (("First", 0), ("Previous", number - 1),
                          ("Next", number + 1), ("Last", pages - 1)):
        if 0 <= target < pages and target != number:
            links.append(f'<a href="{esc(path + "?" + urlencode({**params, "page": target}))}">{label}</a>')
    start = number * PAGE_SIZE + 1 if count else 0
    end = min((number + 1) * PAGE_SIZE, count)
    return (f'<p>Showing {start:,}–{end:,} of {count:,} entries · page {number + 1:,} of {pages:,}. '
            + " · ".join(links) + "</p>")


def overview(groups, csrf, last, review_token):
    rows = []
    for g in groups:
        eligible = bool(g["candidates"])
        selection = (f'<input type="checkbox" name="release" value="{esc(g["id"])}" '
                     f'aria-label="Select {esc(g["label"])}">' if eligible else "Protected / no candidates")
        refs = f'{g["active_references"]:,} active references; {len(g["references"]):,} recorded references'
        links = " · ".join(
            f'<a href="{esc("/retention/inspect?" + urlencode({"review": review_token, "release": g["id"], "kind": kind}))}">'
            f'{len(g[kind]):,} {kind}</a>' for kind in ("references", "files", "errors"))
        rows.append(f"""<tr><td>{selection}</td><td><strong>{esc(g["label"])}</strong><br>{esc(g["state"])}
        <p>{esc(refs)} · {g["missing"]:,} missing files</p>{links}</td>
        <td>{bytes_text(g["local_bytes"])}</td><td>{bytes_text(g["allocated_bytes"])}</td>
        <td>{bytes_text(g["cleanup_bytes"])}</td></tr>""")
    return page("Archive retention", f"""
    <p>Review active and retired releases on this computer. Nothing is removed automatically.
    Active native releases, selected engines, partial downloads, linked files and private settings are protected.</p>
    <p>File bytes and allocated bytes are measured locally, not taken from catalogue estimates.
    Unknown native files and unnamed engine folders are outside this inventory and always left untouched.
    Scanning is read-only and holds the acquisition lock for the full local measurement.
    Every tracked reference is included in the totals. Details are inspected in pages of {PAGE_SIZE};
    they are not loaded into this summary. This snapshot expires after 10 minutes.
    <a href="/retention">Measure again</a> to refresh; cleanup always rechecks the archive.</p>
    <form method="post" action="/retention/preview"><input type="hidden" name="csrf" value="{esc(csrf)}">
    <div class="scroll"><table><thead><tr><th>Select</th><th>Release / references</th><th>Local file bytes</th>
    <th>Allocated on disk</th><th>Eligible file bytes</th></tr></thead><tbody>{''.join(rows)}</tbody></table></div>
    <p><button type="submit">Preview cleanup — no deletion</button></p></form>
    <h2>Last cleanup result</h2><pre>{esc(json.dumps(
        {k: (len(v) if k == "errors" else v) for k, v in last.items()}, indent=2)
        if last else "No cleanup has been performed.")}</pre>
    {('<a href="/retention/result">Inspect the last cleanup result and all errors</a>' if last else '')}""")


def inspection_page(review, token, identity, kind, number):
    if identity not in review.groups or kind not in ("references", "files", "errors"):
        raise ValueError("Unknown release or detail type")
    group = review.groups[identity]
    rows, count = group[kind].page(number)
    navigation = pager("/retention/inspect",
                       {"review": token, "release": identity, "kind": kind}, number, count)
    return page("Inspect " + kind, f"""
    <p>{esc(group["label"])} · read-only snapshot, not a live inventory.
    All {count:,} entries are available through these pages.</p>
    <p><a href="{esc('/retention?' + urlencode({'review': token}))}">Back to this summary</a></p>
    {navigation}<pre>{esc(json.dumps(rows, indent=2))}</pre>{navigation}""")


def proposal_page(proposal, token, csrf, number=0):
    navigation = pager("/retention/proposal", {"proposal": token}, number, len(proposal["files"]))
    files = "".join(f'<li><code>{esc(f["path"])}</code> — {bytes_text(f["bytes"])} '
                    f'(allocated: {bytes_text(f["allocated_bytes"])})</li>'
                    for f in proposal["files"][number * PAGE_SIZE:(number + 1) * PAGE_SIZE])
    return page("Dry-run cleanup proposal", f"""
    <p><strong>No files have been deleted.</strong> This proposal expires in 10 minutes.</p>
    <p>Selected: {esc('; '.join(proposal['labels']))}</p>
    <p>{len(proposal["files"])} files · {bytes_text(proposal["bytes"])} file contents ·
    {bytes_text(proposal["allocated_bytes"])} allocated on disk.</p>
    <p>These are permanent local deletions, not moves to the Recycle Bin. You may need to download
    these retired releases again. Source references remain in the inventory. Protected files and
    private configuration are not in this proposal. Any archive change requires another preview.</p>
    <h2>Exact files proposed for deletion</h2>
    <p>Confirmation deletes all {len(proposal["files"]):,} files in this proposal, across every page,
    not just those shown below. The exact list is held by the server.</p>
    {navigation}<ul>{files}</ul>{navigation}
    <form method="post" action="/retention/cleanup">
    <input type="hidden" name="csrf" value="{esc(csrf)}"><input type="hidden" name="proposal" value="{esc(token)}">
    <label>Type DELETE to confirm these permanent deletions:
    <input name="confirmation" required pattern="DELETE" autocomplete="off"></label>
    <button type="submit">Permanently delete listed files</button> · <a href="/retention">Cancel — keep everything</a></form>""")


def result_page(result, number=0):
    navigation = pager("/retention/result", {}, number, len(result["errors"]))
    summary = {k: v for k, v in result.items() if k != "errors"}
    errors = result["errors"][number * PAGE_SIZE:(number + 1) * PAGE_SIZE]
    return page("Cleanup result", f"""
    <p>Removed {result["removed_files"]} files: {bytes_text(result["removed_bytes"])} of file contents.
    Reclaimed allocation from successfully deleted files: {bytes_text(result["reclaimed_allocated_bytes"])}.</p>
    <p>Observed volume free-space change: {bytes_text(result["free_space_delta_bytes"])}.
    Other applications, open handles, snapshots and filesystem overhead can affect free space.
    Failed deletions are not counted. Only empty managed engine folders are removed;
    folders containing partial downloads remain.</p>
    <pre>{esc(json.dumps(summary,indent=2))}</pre>
    <h2>Deletion errors</h2>{navigation}<pre>{esc(json.dumps(errors,indent=2))}</pre>{navigation}""")
