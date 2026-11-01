"""Disk-backed, short-lived review details. No archive data is cached across scans."""
import hashlib
import json
import sqlite3

PAGE_SIZE = 100


class Rows:
    """A repeatable, streaming collection with indexed, bounded inspection."""
    def __init__(self, review, group, kind, eligible=False):
        self.review, self.group, self.kind = review, group, kind
        self.eligible = eligible

    def query(self):
        return ("FROM details WHERE group_id=? AND kind=?" +
                (" AND protected=0" if self.eligible else ""))

    def append(self, value):
        file = self.kind == "files"
        self.review.db.execute(
            "INSERT INTO details(group_id,kind,sort_key,payload,device,inode,protected) VALUES(?,?,?,?,?,?,?)",
            (self.group, self.kind, value["path"] if file else "",
             json.dumps(value, sort_keys=True),
             str(value["identity"][0]) if file else None,
             str(value["identity"][1]) if file else None,
             int(value["protected"]) if file else 0))

    def __len__(self):
        return self.review.db.execute("SELECT count(*) " + self.query(),
                                      (self.group, self.kind)).fetchone()[0]

    def __bool__(self):
        return self.review.db.execute("SELECT 1 " + self.query() + " LIMIT 1",
                                      (self.group, self.kind)).fetchone() is not None

    def read(self, limit=None, offset=0):
        sql = "SELECT payload,protected " + self.query() + " ORDER BY sort_key,id"
        args = [self.group, self.kind]
        if limit is not None:
            sql += " LIMIT ? OFFSET ?"
            args += [limit, offset]
        for payload, protected in self.review.db.execute(sql, args):
            value = json.loads(payload)
            if self.kind == "files":
                value["protected"] = bool(protected)
            yield value

    def __iter__(self):
        return self.read()

    def __getitem__(self, index):
        if not isinstance(index, int) or index < 0:
            raise IndexError(index)
        try:
            return next(self.read(1, index))
        except StopIteration:
            raise IndexError(index) from None

    def page(self, number):
        count = len(self)
        if number < 0 or number > max(0, (count - 1) // PAGE_SIZE):
            raise ValueError("Page outside this snapshot")
        return list(self.read(PAGE_SIZE, number * PAGE_SIZE)), count


class Review:
    def __init__(self):
        # Empty filename creates a private temporary on-disk database, removed
        # by SQLite on close. Keep each connection's page cache bounded.
        self.db = sqlite3.connect("", check_same_thread=False)
        self.db.executescript("""
            PRAGMA cache_size=-2048;
            PRAGMA temp_store=FILE;
            CREATE TABLE details(id INTEGER PRIMARY KEY, group_id TEXT, kind TEXT,
                sort_key TEXT, payload TEXT, device TEXT, inode TEXT, protected INTEGER);
            CREATE INDEX detail_page ON details(group_id,kind,sort_key,id);
            CREATE TABLE active_objects(device TEXT,inode TEXT,PRIMARY KEY(device,inode));
        """)
        self.groups = {}

    def group(self, identity, label, kind):
        if identity not in self.groups:
            self.groups[identity] = {
                "id": identity, "label": label, "kind": kind, "active_references": 0,
                "missing": 0, **{name: Rows(self, identity, name)
                                for name in ("references", "files", "errors")}}
        return self.groups[identity]

    def protect_active(self):
        for group in self:
            if group["active_references"]:
                self.db.execute("""INSERT OR IGNORE INTO active_objects
                    SELECT device,inode FROM details WHERE group_id=? AND kind='files'""",
                                (group["id"],))
        self.db.execute("""UPDATE details SET protected=1 WHERE kind='files' AND EXISTS
            (SELECT 1 FROM active_objects a WHERE a.device=details.device AND a.inode=details.inode)""")

    def fingerprint(self):
        digest = hashlib.sha256()
        # Explicit record framing; stream ALL details, including those never
        # inspected in a browser. Order is stable across independent scans.
        for group in self:
            for key, value in sorted(group.items()):
                digest.update(json.dumps([group["id"], key]).encode() + b"\n")
                if isinstance(value, Rows):
                    for row in value:
                        digest.update(json.dumps(row, sort_keys=True).encode() + b"\n")
                else:
                    digest.update(json.dumps(value, sort_keys=True).encode() + b"\n")
        return digest.hexdigest()

    def __iter__(self):
        return iter(self.groups.values())

    def __getitem__(self, index):
        return list(self.groups.values())[index]

    def __enter__(self):
        return self

    def close(self):
        self.db.close()

    def __exit__(self, *args):
        self.close()
