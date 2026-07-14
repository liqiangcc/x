"use strict";

module.exports = {
  version: 9,
  up(db) {
    db.exec(`
      ALTER TABLE strategies ADD COLUMN active_revision INTEGER NOT NULL DEFAULT 1;
      ALTER TABLE strategy_templates ADD COLUMN current_revision INTEGER NOT NULL DEFAULT 1;
      CREATE TABLE strategy_revisions (
        strategy_id TEXT NOT NULL REFERENCES strategies(id) ON DELETE CASCADE,
        revision INTEGER NOT NULL,
        schema_version INTEGER NOT NULL,
        config_json TEXT NOT NULL,
        status TEXT NOT NULL,
        template_id TEXT,
        template_revision INTEGER,
        failure_reason TEXT,
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY (strategy_id, revision)
      );
      CREATE TABLE strategy_template_revisions (
        template_id TEXT NOT NULL REFERENCES strategy_templates(id) ON DELETE CASCADE,
        revision INTEGER NOT NULL,
        definition_json TEXT NOT NULL,
        description TEXT,
        content_hash TEXT NOT NULL,
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY (template_id, revision)
      );
      INSERT INTO strategy_revisions (strategy_id, revision, schema_version, config_json, status, failure_reason)
        SELECT id, 1, 2, config_json, status, failure_reason FROM strategies;
      INSERT INTO strategy_template_revisions (template_id, revision, definition_json, description, content_hash)
        SELECT id, 1, definition_json, description, lower(hex(randomblob(16))) FROM strategy_templates;
      CREATE INDEX idx_strategy_revisions_status ON strategy_revisions(strategy_id, status, revision);
    `);
  },
};
