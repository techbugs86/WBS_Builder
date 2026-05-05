-- WBS Builder — MySQL Schema (multi-tenant)
-- Run: mysql -u root < schema.sql
-- ─────────────────────────────────────────────────────────────────────────────

CREATE DATABASE IF NOT EXISTS wbs_builder;
USE wbs_builder;

-- Tenant root
CREATE TABLE IF NOT EXISTS organisations (
  id VARCHAR(36) PRIMARY KEY,
  name VARCHAR(255) NOT NULL,
  slug VARCHAR(100) UNIQUE NOT NULL,
  plan ENUM('trial','pro','enterprise') NOT NULL DEFAULT 'trial',
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Users are global (email unique across platform); membership is per-org via org_members
CREATE TABLE IF NOT EXISTS users (
  id VARCHAR(36) PRIMARY KEY,
  last_org_id VARCHAR(36) DEFAULT NULL,   -- org the user last logged into
  email VARCHAR(255) UNIQUE NOT NULL,
  name VARCHAR(255) NOT NULL,
  role ENUM('admin','pm') NOT NULL,       -- platform-level fallback; actual role is in org_members
  password_hash VARCHAR(255) NOT NULL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- One user can belong to multiple orgs with a role per org
CREATE TABLE IF NOT EXISTS org_members (
  org_id  VARCHAR(36) NOT NULL,
  user_id VARCHAR(36) NOT NULL,
  role    ENUM('owner','admin','pm') NOT NULL DEFAULT 'pm',
  joined_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (org_id, user_id),
  INDEX idx_user (user_id)
);

CREATE TABLE IF NOT EXISTS projects (
  id VARCHAR(36) PRIMARY KEY,
  org_id VARCHAR(36) NOT NULL,
  name VARCHAR(255) NOT NULL,
  client VARCHAR(255) NOT NULL DEFAULT '',
  project_type ENUM('web_app','mobile','api','automation','general') NOT NULL DEFAULT 'web_app',
  estimated_budget VARCHAR(100) DEFAULT '',
  start_date VARCHAR(20) DEFAULT '',
  communication_channel VARCHAR(255) NOT NULL DEFAULT '["upwork"]', -- JSON array of CommunicationChannel
  channel_link TEXT,                                                  -- JSON object { channel: link }
  contact_person VARCHAR(255) DEFAULT '',
  raw_input LONGTEXT,
  provider ENUM('anthropic','openai') NOT NULL DEFAULT 'anthropic',
  status ENUM('draft','in_review','approved','synced') NOT NULL DEFAULT 'draft',
  created_by VARCHAR(36) NOT NULL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_org (org_id),
  INDEX idx_created_by (created_by)
);

CREATE TABLE IF NOT EXISTS briefs (
  id VARCHAR(36) PRIMARY KEY,
  project_id VARCHAR(36) NOT NULL,
  version INT NOT NULL DEFAULT 1,
  is_current TINYINT(1) NOT NULL DEFAULT 1,
  data JSON NOT NULL,
  label VARCHAR(255) DEFAULT '',
  challenge_text TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_project (project_id),
  INDEX idx_current (project_id, is_current)
);

CREATE TABLE IF NOT EXISTS epics (
  id VARCHAR(36) PRIMARY KEY,
  project_id VARCHAR(36) NOT NULL,
  epic_key VARCHAR(36) NOT NULL,
  version INT NOT NULL DEFAULT 1,
  is_current TINYINT(1) NOT NULL DEFAULT 1,
  data JSON NOT NULL,
  label VARCHAR(255) DEFAULT '',
  challenge_text TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_project (project_id),
  INDEX idx_key (epic_key),
  INDEX idx_current (project_id, is_current)
);

CREATE TABLE IF NOT EXISTS journeys (
  id VARCHAR(36) PRIMARY KEY,
  project_id VARCHAR(36) NOT NULL,
  journey_key VARCHAR(36) NOT NULL,
  version INT NOT NULL DEFAULT 1,
  is_current TINYINT(1) NOT NULL DEFAULT 1,
  data JSON NOT NULL,
  label VARCHAR(255) DEFAULT '',
  challenge_text TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_project (project_id),
  INDEX idx_key (journey_key),
  INDEX idx_current (project_id, is_current)
);

CREATE TABLE IF NOT EXISTS tasks (
  id VARCHAR(36) PRIMARY KEY,
  project_id VARCHAR(36) NOT NULL,
  task_key VARCHAR(36) NOT NULL,
  version INT NOT NULL DEFAULT 1,
  is_current TINYINT(1) NOT NULL DEFAULT 1,
  data JSON NOT NULL,
  label VARCHAR(255) DEFAULT '',
  challenge_text TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_project (project_id),
  INDEX idx_key (task_key),
  INDEX idx_current (project_id, is_current)
);

-- Per-org API key store (Anthropic, OpenAI, ClickUp keys)
CREATE TABLE IF NOT EXISTS settings (
  `key` VARCHAR(100) NOT NULL,
  org_id VARCHAR(36) NOT NULL DEFAULT '',
  `value` VARCHAR(1000) NOT NULL DEFAULT '',
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  updated_by VARCHAR(255) DEFAULT 'system',
  PRIMARY KEY (`key`, org_id)
);

-- Per-org, per-project-type prompt configs
-- project_type='general' is the fallback used when no type-specific prompt exists
CREATE TABLE IF NOT EXISTS prompt_configs (
  id VARCHAR(36) PRIMARY KEY,
  org_id VARCHAR(36) NOT NULL DEFAULT '',
  project_type ENUM('general','web_app','mobile','api','automation') NOT NULL DEFAULT 'general',
  stage ENUM('brief_extraction','epic_generation','journey_generation','task_decomposition') NOT NULL,
  label VARCHAR(255) NOT NULL,
  system_prompt TEXT NOT NULL,
  user_prompt_template TEXT NOT NULL,
  version INT NOT NULL DEFAULT 1,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  updated_by VARCHAR(255) DEFAULT 'system',
  UNIQUE KEY uq_stage_type_org (stage, project_type, org_id)
);

-- ClickUp ID mapping per project — idempotent sync requires this
-- entity_type: 'folder' (project), 'list' (epic), 'task' (atomic task)
-- entity_key:  for project = project.id; for epic = epic_key; for task = task_key
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

-- Append-only log of every ClickUp API call made during sync
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

-- Full version history for prompt configs (append-only audit log)
CREATE TABLE IF NOT EXISTS prompt_config_history (
  id VARCHAR(36) PRIMARY KEY,
  prompt_config_id VARCHAR(36) NOT NULL,
  version INT NOT NULL,
  system_prompt TEXT NOT NULL,
  user_prompt_template TEXT NOT NULL,
  updated_by VARCHAR(255) NOT NULL DEFAULT 'system',
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_config (prompt_config_id),
  INDEX idx_version (prompt_config_id, version)
);
