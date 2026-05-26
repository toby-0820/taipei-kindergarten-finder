CREATE TABLE IF NOT EXISTS schools (
  id            TEXT PRIMARY KEY,
  name          TEXT NOT NULL,
  type          TEXT NOT NULL CHECK (type IN ('public','non_profit')),
  district      TEXT NOT NULL,
  address       TEXT NOT NULL,
  lat           REAL,
  lng           REAL,
  phone         TEXT,
  website       TEXT,
  classes_json  TEXT NOT NULL DEFAULT '[]',
  updated_at    INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_schools_district ON schools(district);
CREATE INDEX IF NOT EXISTS idx_schools_type     ON schools(type);

CREATE TABLE IF NOT EXISTS snapshots (
  school_id   TEXT NOT NULL,
  age_band    TEXT NOT NULL,
  capacity    INTEGER NOT NULL,
  reg_p1      INTEGER,
  reg_p2      INTEGER,
  reg_p3      INTEGER,
  reg_p4      INTEGER,
  reg_p5      INTEGER,
  reg_total   INTEGER,
  fetched_at  INTEGER NOT NULL,
  is_latest   INTEGER NOT NULL CHECK (is_latest IN (0,1)),
  PRIMARY KEY (school_id, age_band, is_latest),
  FOREIGN KEY (school_id) REFERENCES schools(id)
);

CREATE INDEX IF NOT EXISTS idx_snapshots_latest ON snapshots(is_latest, school_id);

CREATE TABLE IF NOT EXISTS registration_window (
  id              INTEGER PRIMARY KEY CHECK (id = 1),
  mode            TEXT NOT NULL CHECK (mode IN ('closed','open','drawn')),
  detected_at     INTEGER NOT NULL,
  priority_labels TEXT,
  notes           TEXT
);

INSERT OR IGNORE INTO registration_window (id, mode, detected_at, priority_labels, notes)
VALUES (1, 'closed', strftime('%s','now')*1000, NULL, 'initial state');

CREATE TABLE IF NOT EXISTS scrape_errors (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  source      TEXT NOT NULL,
  message     TEXT NOT NULL,
  occurred_at INTEGER NOT NULL
);
