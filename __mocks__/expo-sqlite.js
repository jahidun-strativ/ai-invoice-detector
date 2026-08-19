/**
 * expo-sqlite under Jest.
 * The real module needs the native runtime, so tests run against Node's
 * built-in SQLite (node:sqlite, Node 22+) — real SQL, no stubbed behaviour,
 * so query bugs actually surface in tests.
 */

const { DatabaseSync } = require('node:sqlite');

function wrap(db) {
  return {
    async execAsync(sql) {
      db.exec(sql);
    },
    async runAsync(sql, params = []) {
      const result = db.prepare(sql).run(...params);
      return {
        lastInsertRowId: Number(result.lastInsertRowid ?? 0),
        changes: Number(result.changes ?? 0),
      };
    },
    async getAllAsync(sql, params = []) {
      return db.prepare(sql).all(...params);
    },
    async getFirstAsync(sql, params = []) {
      return db.prepare(sql).get(...params) ?? null;
    },
    async closeAsync() {
      db.close();
    },
  };
}

const databases = new Map();

module.exports = {
  openDatabaseAsync: async (name) => {
    if (!databases.has(name)) {
      databases.set(name, wrap(new DatabaseSync(':memory:')));
    }
    return databases.get(name);
  },
  // Test helper: drop the in-memory DB between suites
  __reset: () => databases.clear(),
};
