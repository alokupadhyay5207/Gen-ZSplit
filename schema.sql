-- =====================================================================
-- Gen-ZSplit group module schema  (SQLite >= 3.8: partial indexes + composite FKs)
--
-- Design rules
--   1. Money is stored as INTEGER minor units (paise / cents). Never REAL.
--      A 3-way split of 100.00 can then never drift by a floating-point hair.
--   2. Structure is cascade-owned:  groups -> members / expenses / settlements
--      / activity  and  expenses -> splits.  Deleting a group leaves nothing.
--   3. Financial history is never destroyed by accident: users referenced by
--      payments are protected by RESTRICT (default NO ACTION).
--   4. Composite foreign keys make illegal rows impossible at the DB layer:
--        * an expense can only be paid by someone who is a member of THAT group
--        * a split row can only belong to a member of the expense's own group
--        * a settlement can only move money between members of its own group
--      The Flask validation is a friendly first line; these are the backstop.
--   5. Every connection MUST run  PRAGMA foreign_keys = ON  (db.connect does).
-- =====================================================================

CREATE TABLE IF NOT EXISTS groups (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    name          TEXT    NOT NULL CHECK (length(trim(name)) BETWEEN 2 AND 60),
    description   TEXT    NOT NULL DEFAULT '' CHECK (length(description) <= 280),
    invite_code   TEXT    NOT NULL UNIQUE,
    password_hash TEXT    NOT NULL,
    owner_id      INTEGER NOT NULL REFERENCES users(id),
    currency      TEXT    NOT NULL DEFAULT 'INR'
                  CHECK (currency IN ('INR','USD','EUR','GBP','AED','JPY')),
    created_at    TEXT    NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS group_members (
    id        INTEGER PRIMARY KEY AUTOINCREMENT,
    group_id  INTEGER NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
    user_id   INTEGER NOT NULL REFERENCES users(id)  ON DELETE CASCADE,
    role      TEXT    NOT NULL DEFAULT 'member' CHECK (role   IN ('owner','member')),
    status    TEXT    NOT NULL DEFAULT 'active' CHECK (status IN ('active','removed')),
    joined_at TEXT    NOT NULL DEFAULT (datetime('now')),
    UNIQUE (group_id, user_id)            -- also the parent key for composite FKs
);
CREATE INDEX IF NOT EXISTS ix_members_user  ON group_members (user_id, status);
CREATE INDEX IF NOT EXISTS ix_members_group ON group_members (group_id, status);
-- Exactly one active owner per group.
CREATE UNIQUE INDEX IF NOT EXISTS ux_one_active_owner
    ON group_members (group_id) WHERE role = 'owner' AND status = 'active';

CREATE TABLE IF NOT EXISTS group_expenses (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    group_id     INTEGER NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
    paid_by      INTEGER NOT NULL,
    title        TEXT    NOT NULL CHECK (length(trim(title)) BETWEEN 1 AND 120),
    amount_minor INTEGER NOT NULL CHECK (amount_minor > 0),
    category     TEXT    NOT NULL DEFAULT 'Other',
    expense_date TEXT    NOT NULL CHECK (date(expense_date) IS NOT NULL AND date(expense_date) = expense_date),
                              -- NULL-safe: CHECK(NULL) would PASS, and date('junk') is NULL
    split_method TEXT    NOT NULL CHECK (split_method IN ('equal','exact','percentage')),
    notes        TEXT    NOT NULL DEFAULT '' CHECK (length(notes) <= 500),
    created_by   INTEGER NOT NULL REFERENCES users(id),
    created_at   TEXT    NOT NULL DEFAULT (datetime('now')),
    deleted_at   TEXT,
    deleted_by   INTEGER REFERENCES users(id) ON DELETE SET NULL,
    UNIQUE (id, group_id),                -- parent key for expense_splits
    FOREIGN KEY (group_id, paid_by) REFERENCES group_members (group_id, user_id)
);
CREATE INDEX IF NOT EXISTS ix_expenses_group
    ON group_expenses (group_id, deleted_at, expense_date DESC, id DESC);

CREATE TABLE IF NOT EXISTS expense_splits (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    expense_id  INTEGER NOT NULL,
    group_id    INTEGER NOT NULL,
    user_id     INTEGER NOT NULL,
    share_minor INTEGER NOT NULL CHECK (share_minor >= 0),
    share_bp    INTEGER CHECK (share_bp IS NULL OR share_bp BETWEEN 0 AND 10000),
    UNIQUE (expense_id, user_id),
    FOREIGN KEY (expense_id, group_id) REFERENCES group_expenses (id, group_id)
        ON DELETE CASCADE,
    FOREIGN KEY (group_id, user_id) REFERENCES group_members (group_id, user_id)
);
CREATE INDEX IF NOT EXISTS ix_splits_user ON expense_splits (user_id);

CREATE TABLE IF NOT EXISTS settlements (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    group_id     INTEGER NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
    payer_id     INTEGER NOT NULL,
    receiver_id  INTEGER NOT NULL,
    amount_minor INTEGER NOT NULL CHECK (amount_minor > 0),
    created_by   INTEGER NOT NULL REFERENCES users(id),
    created_at   TEXT    NOT NULL DEFAULT (datetime('now')),
    CHECK (payer_id <> receiver_id),
    FOREIGN KEY (group_id, payer_id)    REFERENCES group_members (group_id, user_id),
    FOREIGN KEY (group_id, receiver_id) REFERENCES group_members (group_id, user_id)
);
CREATE INDEX IF NOT EXISTS ix_settlements_group ON settlements (group_id);

CREATE TABLE IF NOT EXISTS group_activity (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    group_id    INTEGER NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
    actor_id    INTEGER REFERENCES users(id) ON DELETE SET NULL,
    kind        TEXT    NOT NULL,
    description TEXT    NOT NULL,
    expense_id  INTEGER REFERENCES group_expenses(id) ON DELETE SET NULL,
    created_at  TEXT    NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS ix_activity_group ON group_activity (group_id, id DESC);
