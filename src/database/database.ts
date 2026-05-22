import * as SQLite from 'expo-sqlite';

let db: SQLite.SQLiteDatabase | null = null;

export async function getDatabase(): Promise<SQLite.SQLiteDatabase> {
  if (db) return db;
  db = await SQLite.openDatabaseAsync('upande_harvest.db');
  await runMigrations(db);
  return db;
}

async function runMigrations(database: SQLite.SQLiteDatabase): Promise<void> {
  await database.execAsync(`
    PRAGMA journal_mode = WAL;
    PRAGMA foreign_keys = ON;

    CREATE TABLE IF NOT EXISTS shelves (
      shelf_id TEXT PRIMARY KEY NOT NULL,
      side TEXT NOT NULL,
      position INTEGER NOT NULL,
      level TEXT NOT NULL,
      farm TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS shelf_items (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      shelf_id TEXT NOT NULL,
      bucket_id TEXT NOT NULL,
      variety TEXT NOT NULL DEFAULT '',
      stem_length TEXT NOT NULL DEFAULT '',
      stem_qty INTEGER NOT NULL DEFAULT 0,
      greenhouse TEXT NOT NULL DEFAULT '',
      date_added TEXT NOT NULL DEFAULT (datetime('now')),
      synced INTEGER NOT NULL DEFAULT 0,
      FOREIGN KEY (shelf_id) REFERENCES shelves(shelf_id)
    );

    CREATE TABLE IF NOT EXISTS sync_queue (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      action TEXT NOT NULL,
      payload TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      status TEXT NOT NULL DEFAULT 'pending',
      error_message TEXT
    );

    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY NOT NULL,
      value TEXT NOT NULL
    );

    CREATE UNIQUE INDEX IF NOT EXISTS idx_shelf_items_bucket
      ON shelf_items(bucket_id);

    CREATE INDEX IF NOT EXISTS idx_shelf_items_shelf
      ON shelf_items(shelf_id);

    CREATE INDEX IF NOT EXISTS idx_sync_queue_status
      ON sync_queue(status);

    CREATE TABLE IF NOT EXISTS grading_entries (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      bunch_id TEXT NOT NULL,
      grader TEXT NOT NULL,
      bucket_id TEXT NOT NULL,
      farm TEXT NOT NULL DEFAULT '',
      variety TEXT NOT NULL DEFAULT '',
      stem_length TEXT NOT NULL DEFAULT '',
      qty INTEGER NOT NULL DEFAULT 0,
      date_added TEXT NOT NULL DEFAULT (datetime('now')),
      synced INTEGER NOT NULL DEFAULT 0
    );

    DROP TABLE IF EXISTS harvest_entries;

    CREATE TABLE IF NOT EXISTS harvest_entries (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      item_code TEXT NOT NULL DEFAULT '',
      quantity REAL NOT NULL DEFAULT 0,
      section TEXT NOT NULL DEFAULT '',
      harvester TEXT NOT NULL DEFAULT '',
      bucket_id TEXT NOT NULL DEFAULT '',
      farm TEXT NOT NULL DEFAULT '',
      greenhouse TEXT NOT NULL DEFAULT '',
      stock_entry TEXT NOT NULL DEFAULT '',
      date_added TEXT NOT NULL DEFAULT (datetime('now')),
      synced INTEGER NOT NULL DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS receiving_entries (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      bucket_id TEXT NOT NULL DEFAULT '',
      date_added TEXT NOT NULL DEFAULT (datetime('now')),
      synced INTEGER NOT NULL DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS packing_boxes (
      box_id TEXT PRIMARY KEY NOT NULL,
      farm TEXT NOT NULL DEFAULT '',
      date_created TEXT NOT NULL DEFAULT (datetime('now')),
      synced INTEGER NOT NULL DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS packing_box_items (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      box_id TEXT NOT NULL,
      bunch_id TEXT NOT NULL,
      date_added TEXT NOT NULL DEFAULT (datetime('now')),
      synced INTEGER NOT NULL DEFAULT 0,
      FOREIGN KEY (box_id) REFERENCES packing_boxes(box_id)
    );

    CREATE TABLE IF NOT EXISTS quality_entries (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      section TEXT NOT NULL DEFAULT '',
      ref_id TEXT NOT NULL DEFAULT '',
      quantity INTEGER NOT NULL DEFAULT 0,
      reason TEXT NOT NULL DEFAULT '',
      notes TEXT NOT NULL DEFAULT '',
      farm TEXT NOT NULL DEFAULT '',
      date_added TEXT NOT NULL DEFAULT (datetime('now')),
      synced INTEGER NOT NULL DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS quarantine_batches (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      batch_id TEXT NOT NULL DEFAULT '',
      scope TEXT NOT NULL DEFAULT 'buckets',
      greenhouse TEXT NOT NULL DEFAULT '',
      bucket_ids TEXT NOT NULL DEFAULT '[]',
      reason TEXT NOT NULL DEFAULT '',
      notes TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL DEFAULT 'pending',
      date_added TEXT NOT NULL DEFAULT (datetime('now')),
      synced INTEGER NOT NULL DEFAULT 0
    );
  `);

  // Migration: rename bunch_id → bucket_id if old schema exists
  try {
    await database.execAsync(`ALTER TABLE receiving_entries RENAME COLUMN bunch_id TO bucket_id`);
  } catch {
    // Column already renamed or doesn't exist — safe to ignore
  }

  // Migration: add greenhouse/variety/quarantine fields to quality_entries
  const qualityMigrations = [
    `ALTER TABLE quality_entries ADD COLUMN greenhouse TEXT NOT NULL DEFAULT ''`,
    `ALTER TABLE quality_entries ADD COLUMN variety TEXT NOT NULL DEFAULT ''`,
    `ALTER TABLE quality_entries ADD COLUMN quarantined INTEGER NOT NULL DEFAULT 0`,
    `ALTER TABLE quality_entries ADD COLUMN quarantine_action TEXT NOT NULL DEFAULT ''`,
  ];
  for (const sql of qualityMigrations) {
    try {
      await database.execAsync(sql);
    } catch {
      // Column already exists — safe to ignore
    }
  }

  // Migration: add packing box / item columns for OPL-driven pack flow
  const packingMigrations = [
    `ALTER TABLE packing_boxes ADD COLUMN opl TEXT`,
    `ALTER TABLE packing_boxes ADD COLUMN sales_order TEXT`,
    `ALTER TABLE packing_boxes ADD COLUMN customer TEXT`,
    `ALTER TABLE packing_boxes ADD COLUMN pack_rate INTEGER`,
    `ALTER TABLE packing_boxes ADD COLUMN status TEXT`,
    `ALTER TABLE packing_boxes ADD COLUMN box_sequence INTEGER`,
    `ALTER TABLE packing_boxes ADD COLUMN total_boxes INTEGER`,
    `ALTER TABLE packing_box_items ADD COLUMN stems INTEGER NOT NULL DEFAULT 0`,
    `ALTER TABLE packing_box_items ADD COLUMN variety TEXT NOT NULL DEFAULT ''`,
    `ALTER TABLE packing_box_items ADD COLUMN stem_length TEXT NOT NULL DEFAULT ''`,
    `ALTER TABLE packing_box_items ADD COLUMN bunch_size TEXT NOT NULL DEFAULT ''`,
  ];
  for (const sql of packingMigrations) {
    try {
      await database.execAsync(sql);
    } catch {
      // Column already exists — safe to ignore
    }
  }

  // Migration: actual harvest entries table
  await database.execAsync(`
    CREATE TABLE IF NOT EXISTS actual_harvest_entries (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      greenhouse TEXT NOT NULL DEFAULT '',
      variety TEXT NOT NULL DEFAULT '',
      quantity INTEGER NOT NULL DEFAULT 0,
      harvest_date TEXT NOT NULL DEFAULT (date('now')),
      notes TEXT NOT NULL DEFAULT '',
      farm TEXT NOT NULL DEFAULT '',
      date_added TEXT NOT NULL DEFAULT (datetime('now')),
      synced INTEGER NOT NULL DEFAULT 0
    );
  `);
}

export async function resetDatabase(): Promise<void> {
  const database = await getDatabase();
  await database.execAsync(`
    DELETE FROM shelf_items;
    DELETE FROM shelves;
    DELETE FROM sync_queue;
    DELETE FROM grading_entries;
    DELETE FROM harvest_entries;
    DELETE FROM receiving_entries;
    DELETE FROM packing_box_items;
    DELETE FROM packing_boxes;
    DELETE FROM quality_entries;
  `);
}
