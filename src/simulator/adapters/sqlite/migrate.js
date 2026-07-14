"use strict";

const migrations = [
  require("./migrations/001_initial"),
  require("./migrations/002_indexes"),
  require("./migrations/003_accounts"),
  require("./migrations/004_strategy_index"),
  require("./migrations/005_strategy_archive"),
  require("./migrations/006_strategy_algorithm"),
  require("./migrations/007_watchlist_signals"),
  require("./migrations/008_strategy_templates"),
  require("./migrations/009_strategy_revisions"),
];

function migrate(db) {
  db.exec("CREATE TABLE IF NOT EXISTS schema_migrations (version INTEGER PRIMARY KEY, applied_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP)");
  const applied = new Set(db.prepare("SELECT version FROM schema_migrations").all().map((row) => row.version));
  const apply = db.transaction((migration) => {
    migration.up(db);
    db.prepare("INSERT INTO schema_migrations (version) VALUES (?)").run(migration.version);
  });
  for (const migration of migrations.sort((left, right) => left.version - right.version)) {
    if (!applied.has(migration.version)) apply(migration);
  }
  return db.prepare("SELECT version FROM schema_migrations ORDER BY version").all().map((row) => row.version);
}

module.exports = {
  migrate,
  migrations,
};
