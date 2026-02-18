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
      bunch_id TEXT NOT NULL,
      receiver TEXT NOT NULL DEFAULT '',
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
  `);
}
