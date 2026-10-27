-- Per-user rule that schedules a finished task's best clips automatically.
-- One row per user. post_times are local HH:MM slots in the rule's timezone.
CREATE TABLE IF NOT EXISTS social_auto_publish (
    user_id VARCHAR(36) PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    enabled BOOLEAN NOT NULL DEFAULT false,
    social_account_ids TEXT[] NOT NULL DEFAULT '{}',
    clips_per_task INTEGER NOT NULL DEFAULT 2,
    min_virality_score INTEGER NOT NULL DEFAULT 0,
    post_times TEXT[] NOT NULL DEFAULT '{18:00}',
    timezone VARCHAR(64) NOT NULL DEFAULT 'America/Sao_Paulo',
    privacy_level VARCHAR(20) NOT NULL DEFAULT 'public',
    hashtags TEXT[] NOT NULL DEFAULT '{}',
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
)
