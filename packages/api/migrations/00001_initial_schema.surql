-- Migration: Initial Schema
-- NovaCortex SaaS Database Schema

-- ============================================
-- Users & Authentication
-- ============================================

DEFINE TABLE IF NOT EXISTS users SCHEMAFULL;
DEFINE FIELD email ON TABLE users TYPE string ASSERT string::is::email($value);
DEFINE FIELD password_hash ON TABLE users TYPE string;
DEFINE FIELD name ON TABLE users TYPE option<string>;
DEFINE FIELD avatar_url ON TABLE users TYPE option<string>;
DEFINE FIELD role ON TABLE users TYPE string DEFAULT 'user';
DEFINE FIELD status ON TABLE users TYPE string DEFAULT 'active';
DEFINE FIELD created_at ON TABLE users TYPE datetime DEFAULT time::now();
DEFINE FIELD updated_at ON TABLE users TYPE datetime DEFAULT time::now();
DEFINE FIELD last_login ON TABLE users TYPE option<datetime>;
DEFINE FIELD metadata ON TABLE users TYPE option<object>;

DEFINE INDEX users_email ON TABLE users FIELDS email UNIQUE;
DEFINE INDEX users_status ON TABLE users FIELDS status;

-- API Keys
DEFINE TABLE IF NOT EXISTS api_keys SCHEMAFULL;
DEFINE FIELD user ON TABLE api_keys TYPE record<users>;
DEFINE FIELD name ON TABLE api_keys TYPE string;
DEFINE FIELD key_hash ON TABLE api_keys TYPE string;
DEFINE FIELD prefix ON TABLE api_keys TYPE string;
DEFINE FIELD scopes ON TABLE api_keys TYPE array<string> DEFAULT [];
DEFINE FIELD last_used ON TABLE api_keys TYPE option<datetime>;
DEFINE FIELD expires_at ON TABLE api_keys TYPE option<datetime>;
DEFINE FIELD created_at ON TABLE api_keys TYPE datetime DEFAULT time::now();
DEFINE FIELD revoked_at ON TABLE api_keys TYPE option<datetime>;

DEFINE INDEX api_keys_prefix ON TABLE api_keys FIELDS prefix;
DEFINE INDEX api_keys_user ON TABLE api_keys FIELDS user;

-- ============================================
-- Namespaces & Organizations
-- ============================================

DEFINE TABLE IF NOT EXISTS namespaces SCHEMAFULL;
DEFINE FIELD name ON TABLE namespaces TYPE string;
DEFINE FIELD slug ON TABLE namespaces TYPE string;
DEFINE FIELD owner ON TABLE namespaces TYPE record<users>;
DEFINE FIELD description ON TABLE namespaces TYPE option<string>;
DEFINE FIELD settings ON TABLE namespaces TYPE option<object>;
DEFINE FIELD created_at ON TABLE namespaces TYPE datetime DEFAULT time::now();
DEFINE FIELD updated_at ON TABLE namespaces TYPE datetime DEFAULT time::now();

DEFINE INDEX namespaces_slug ON TABLE namespaces FIELDS slug UNIQUE;
DEFINE INDEX namespaces_owner ON TABLE namespaces FIELDS owner;

-- Namespace Members
DEFINE TABLE IF NOT EXISTS namespace_members SCHEMAFULL;
DEFINE FIELD namespace ON TABLE namespace_members TYPE record<namespaces>;
DEFINE FIELD user ON TABLE namespace_members TYPE record<users>;
DEFINE FIELD role ON TABLE namespace_members TYPE string DEFAULT 'member';
DEFINE FIELD joined_at ON TABLE namespace_members TYPE datetime DEFAULT time::now();

DEFINE INDEX namespace_members_composite ON TABLE namespace_members FIELDS namespace, user UNIQUE;

-- ============================================
-- Memories
-- ============================================

DEFINE TABLE IF NOT EXISTS memories SCHEMAFULL;
DEFINE FIELD namespace ON TABLE memories TYPE string DEFAULT 'default';
DEFINE FIELD memory_type ON TABLE memories TYPE string;
DEFINE FIELD content ON TABLE memories TYPE string;
DEFINE FIELD embedding_id ON TABLE memories TYPE option<string>;
DEFINE FIELD salience ON TABLE memories TYPE float DEFAULT 5.0;
DEFINE FIELD confidence ON TABLE memories TYPE float DEFAULT 1.0;
DEFINE FIELD decay_rate ON TABLE memories TYPE float DEFAULT 0.1;
DEFINE FIELD access_count ON TABLE memories TYPE int DEFAULT 0;
DEFINE FIELD last_accessed ON TABLE memories TYPE option<datetime>;
DEFINE FIELD tags ON TABLE memories TYPE array<string> DEFAULT [];
DEFINE FIELD metadata ON TABLE memories TYPE option<object>;
DEFINE FIELD source ON TABLE memories TYPE option<object>;
DEFINE FIELD entities ON TABLE memories TYPE array<object> DEFAULT [];
DEFINE FIELD signals ON TABLE memories TYPE array<object> DEFAULT [];
DEFINE FIELD created_at ON TABLE memories TYPE datetime DEFAULT time::now();
DEFINE FIELD updated_at ON TABLE memories TYPE datetime DEFAULT time::now();

DEFINE INDEX memories_namespace ON TABLE memories FIELDS namespace;
DEFINE INDEX memories_type ON TABLE memories FIELDS memory_type;
DEFINE INDEX memories_namespace_type ON TABLE memories FIELDS namespace, memory_type;
DEFINE INDEX memories_salience ON TABLE memories FIELDS salience;
DEFINE INDEX memories_tags ON TABLE memories FIELDS tags;

-- Memory Relations
DEFINE TABLE IF NOT EXISTS memory_relations SCHEMAFULL;
DEFINE FIELD from_memory ON TABLE memory_relations TYPE record<memories>;
DEFINE FIELD to_memory ON TABLE memory_relations TYPE record<memories>;
DEFINE FIELD relation_type ON TABLE memory_relations TYPE string;
DEFINE FIELD strength ON TABLE memory_relations TYPE float DEFAULT 1.0;
DEFINE FIELD metadata ON TABLE memory_relations TYPE option<object>;
DEFINE FIELD created_at ON TABLE memory_relations TYPE datetime DEFAULT time::now();

DEFINE INDEX memory_relations_from ON TABLE memory_relations FIELDS from_memory;
DEFINE INDEX memory_relations_to ON TABLE memory_relations FIELDS to_memory;
DEFINE INDEX memory_relations_type ON TABLE memory_relations FIELDS relation_type;

-- ============================================
-- Sessions
-- ============================================

DEFINE TABLE IF NOT EXISTS sessions SCHEMAFULL;
DEFINE FIELD session_id ON TABLE sessions TYPE string;
DEFINE FIELD namespace ON TABLE sessions TYPE string DEFAULT 'sessions';
DEFINE FIELD agent_id ON TABLE sessions TYPE option<string>;
DEFINE FIELD status ON TABLE sessions TYPE string DEFAULT 'active';
DEFINE FIELD summary ON TABLE sessions TYPE option<string>;
DEFINE FIELD metadata ON TABLE sessions TYPE option<object>;
DEFINE FIELD started_at ON TABLE sessions TYPE datetime DEFAULT time::now();
DEFINE FIELD ended_at ON TABLE sessions TYPE option<datetime>;

DEFINE INDEX sessions_session_id ON TABLE sessions FIELDS session_id UNIQUE;
DEFINE INDEX sessions_namespace ON TABLE sessions FIELDS namespace;
DEFINE INDEX sessions_status ON TABLE sessions FIELDS status;

-- Session Turns
DEFINE TABLE IF NOT EXISTS session_turns SCHEMAFULL;
DEFINE FIELD session ON TABLE session_turns TYPE record<sessions>;
DEFINE FIELD role ON TABLE session_turns TYPE string;
DEFINE FIELD content ON TABLE session_turns TYPE string;
DEFINE FIELD memory ON TABLE session_turns TYPE option<record<memories>>;
DEFINE FIELD metadata ON TABLE session_turns TYPE option<object>;
DEFINE FIELD created_at ON TABLE session_turns TYPE datetime DEFAULT time::now();

DEFINE INDEX session_turns_session ON TABLE session_turns FIELDS session;

-- ============================================
-- Audit Log
-- ============================================

DEFINE TABLE IF NOT EXISTS audit_log SCHEMAFULL;
DEFINE FIELD actor ON TABLE audit_log TYPE option<record<users>>;
DEFINE FIELD action ON TABLE audit_log TYPE string;
DEFINE FIELD resource_type ON TABLE audit_log TYPE string;
DEFINE FIELD resource_id ON TABLE audit_log TYPE string;
DEFINE FIELD details ON TABLE audit_log TYPE option<object>;
DEFINE FIELD ip_address ON TABLE audit_log TYPE option<string>;
DEFINE FIELD user_agent ON TABLE audit_log TYPE option<string>;
DEFINE FIELD created_at ON TABLE audit_log TYPE datetime DEFAULT time::now();

DEFINE INDEX audit_log_actor ON TABLE audit_log FIELDS actor;
DEFINE INDEX audit_log_action ON TABLE audit_log FIELDS action;
DEFINE INDEX audit_log_resource ON TABLE audit_log FIELDS resource_type, resource_id;
DEFINE INDEX audit_log_created ON TABLE audit_log FIELDS created_at;

-- ============================================
-- Usage & Billing
-- ============================================

DEFINE TABLE IF NOT EXISTS usage_metrics SCHEMAFULL;
DEFINE FIELD namespace ON TABLE usage_metrics TYPE string;
DEFINE FIELD metric_type ON TABLE usage_metrics TYPE string;
DEFINE FIELD value ON TABLE usage_metrics TYPE float;
DEFINE FIELD period_start ON TABLE usage_metrics TYPE datetime;
DEFINE FIELD period_end ON TABLE usage_metrics TYPE datetime;
DEFINE FIELD metadata ON TABLE usage_metrics TYPE option<object>;
DEFINE FIELD created_at ON TABLE usage_metrics TYPE datetime DEFAULT time::now();

DEFINE INDEX usage_metrics_namespace ON TABLE usage_metrics FIELDS namespace;
DEFINE INDEX usage_metrics_type ON TABLE usage_metrics FIELDS metric_type;
DEFINE INDEX usage_metrics_period ON TABLE usage_metrics FIELDS period_start, period_end;
