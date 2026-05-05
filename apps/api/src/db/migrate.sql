-- WBS Builder — Multi-tenant migration
-- Run once: mysql -u root wbs_builder < apps/api/src/db/migrate.sql
-- Safe to re-run: uses IF NOT EXISTS for tables, IGNORE for indexes and duplicate rows.
-- ─────────────────────────────────────────────────────────────────────────────

USE wbs_builder;

-- 1. organisations table
CREATE TABLE IF NOT EXISTS organisations (
  id VARCHAR(36) PRIMARY KEY,
  name VARCHAR(255) NOT NULL,
  slug VARCHAR(100) UNIQUE NOT NULL,
  plan ENUM('trial','pro','enterprise') NOT NULL DEFAULT 'trial',
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- 2. org_members — one user can belong to multiple orgs, with a role per org
CREATE TABLE IF NOT EXISTS org_members (
  org_id  VARCHAR(36) NOT NULL,
  user_id VARCHAR(36) NOT NULL,
  role    ENUM('owner','admin','pm') NOT NULL DEFAULT 'pm',
  joined_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (org_id, user_id),
  INDEX idx_user (user_id)
);

-- 3. users: add last_org_id (used to resume the user's last active org)
SET @col_exists = (
  SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'users' AND COLUMN_NAME = 'last_org_id'
);
SET @sql = IF(@col_exists = 0,
  'ALTER TABLE users ADD COLUMN last_org_id VARCHAR(36) DEFAULT NULL',
  'SELECT 1'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- 4. projects: add org_id
SET @col_exists = (
  SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'projects' AND COLUMN_NAME = 'org_id'
);
SET @sql = IF(@col_exists = 0,
  "ALTER TABLE projects ADD COLUMN org_id VARCHAR(36) NOT NULL DEFAULT '' AFTER id",
  'SELECT 1'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- Add index on projects.org_id if missing
SET @idx_exists = (
  SELECT COUNT(*) FROM information_schema.STATISTICS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'projects' AND INDEX_NAME = 'idx_projects_org'
);
SET @sql = IF(@idx_exists = 0,
  'ALTER TABLE projects ADD INDEX idx_projects_org (org_id)',
  'SELECT 1'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- 5. settings: add org_id column, then fix the primary key
SET @col_exists = (
  SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'settings' AND COLUMN_NAME = 'org_id'
);
SET @sql = IF(@col_exists = 0,
  "ALTER TABLE settings ADD COLUMN org_id VARCHAR(36) NOT NULL DEFAULT '' AFTER `key`",
  'SELECT 1'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- Re-create primary key as composite (key, org_id) if it's still just (key)
SET @pk_is_composite = (
  SELECT COUNT(*) FROM information_schema.KEY_COLUMN_USAGE
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'settings'
    AND CONSTRAINT_NAME = 'PRIMARY' AND COLUMN_NAME = 'org_id'
);
SET @sql = IF(@pk_is_composite = 0,
  'ALTER TABLE settings DROP PRIMARY KEY, ADD PRIMARY KEY (`key`, org_id)',
  'SELECT 1'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- 6. prompt_configs: add org_id column, then fix unique constraint
SET @col_exists = (
  SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'prompt_configs' AND COLUMN_NAME = 'org_id'
);
SET @sql = IF(@col_exists = 0,
  "ALTER TABLE prompt_configs ADD COLUMN org_id VARCHAR(36) NOT NULL DEFAULT '' AFTER id",
  'SELECT 1'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- Drop old single-column stage unique index if it still exists
SET @idx_exists = (
  SELECT COUNT(*) FROM information_schema.STATISTICS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'prompt_configs'
    AND INDEX_NAME = 'stage' AND SEQ_IN_INDEX = 1
);
SET @sql = IF(@idx_exists > 0,
  'ALTER TABLE prompt_configs DROP INDEX stage',
  'SELECT 1'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- Add composite unique key (stage, org_id) if missing
SET @idx_exists = (
  SELECT COUNT(*) FROM information_schema.STATISTICS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'prompt_configs' AND INDEX_NAME = 'uq_stage_org'
);
SET @sql = IF(@idx_exists = 0,
  'ALTER TABLE prompt_configs ADD UNIQUE KEY uq_stage_org (stage, org_id)',
  'SELECT 1'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- 7. Seed default org
INSERT IGNORE INTO organisations (id, name, slug, plan)
VALUES ('org-1', 'WBS Agency', 'wbs-agency', 'trial');

-- 8. Backfill org_id on all existing tenant rows to org-1
UPDATE projects       SET org_id = 'org-1' WHERE org_id = '';
UPDATE settings       SET org_id = 'org-1' WHERE org_id = '';
UPDATE prompt_configs SET org_id = 'org-1' WHERE org_id = '';
UPDATE users          SET last_org_id = 'org-1' WHERE last_org_id IS NULL;

-- 9. Add all existing users as org-1 members (INSERT IGNORE = no-op if row exists)
INSERT IGNORE INTO org_members (org_id, user_id, role)
SELECT 'org-1', id,
  CASE role WHEN 'admin' THEN 'admin' ELSE 'pm' END
FROM users;

-- ─── Project type alignment ────────────────────────────────────────────────
-- Removes desktop/other, adds automation to match prompt_configs project types.
-- Existing desktop/other projects are remapped to web_app before the column change.

UPDATE projects SET project_type = 'web_app' WHERE project_type IN ('desktop', 'other');
ALTER TABLE projects MODIFY COLUMN project_type ENUM('web_app','mobile','api','automation','general') NOT NULL DEFAULT 'web_app';

-- ─── ClickUp sync support ─────────────────────────────────────────────────────
-- Idempotent ClickUp ID mapping (project → folder, epic → list, task → task).
CREATE TABLE IF NOT EXISTS clickup_mappings (
  id VARCHAR(36) PRIMARY KEY,
  project_id VARCHAR(36) NOT NULL,
  entity_type ENUM('folder','list','task') NOT NULL,
  entity_key VARCHAR(36) NOT NULL,
  clickup_id VARCHAR(64) NOT NULL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_project_entity (project_id, entity_type, entity_key),
  INDEX idx_project (project_id),
  INDEX idx_clickup (clickup_id)
);

CREATE TABLE IF NOT EXISTS sync_log (
  id VARCHAR(36) PRIMARY KEY,
  project_id VARCHAR(36) NOT NULL,
  wbs_id VARCHAR(64) DEFAULT '',
  method VARCHAR(8) NOT NULL,
  url VARCHAR(500) NOT NULL,
  status_code INT NOT NULL DEFAULT 0,
  duration_ms INT NOT NULL DEFAULT 0,
  ok TINYINT(1) NOT NULL DEFAULT 0,
  error TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_project (project_id),
  INDEX idx_created (created_at)
);

-- ─── Multi-channel support ────────────────────────────────────────────────────
-- Converts communication_channel from ENUM to JSON array VARCHAR.
-- Wraps existing single values into arrays e.g. 'upwork' → '["upwork"]'
ALTER TABLE projects MODIFY COLUMN communication_channel VARCHAR(255) NOT NULL DEFAULT '["upwork"]';
UPDATE projects SET communication_channel = CONCAT('["', communication_channel, '"]')
  WHERE communication_channel NOT LIKE '[%';
-- channel_link stays TEXT; existing links are migrated to JSON object keyed by first channel
UPDATE projects
  SET channel_link = CONCAT(
    '{"',
    TRIM(BOTH '"' FROM JSON_UNQUOTE(JSON_EXTRACT(communication_channel, '$[0]'))),
    '":"', REPLACE(IFNULL(channel_link,''), '"', '\\"'), '"}'
  )
  WHERE channel_link IS NOT NULL AND channel_link != '' AND channel_link NOT LIKE '{%';
