-- Echo Asset Manager v1.0.0 — AI-Powered Asset & Portfolio Management
-- D1 Schema

CREATE TABLE IF NOT EXISTS organizations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  slug TEXT NOT NULL UNIQUE,
  currency TEXT DEFAULT 'USD',
  fiscal_year_start INTEGER DEFAULT 1,
  depreciation_method TEXT DEFAULT 'straight_line',
  settings JSON DEFAULT '{}',
  status TEXT DEFAULT 'active',
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  org_id INTEGER NOT NULL,
  name TEXT NOT NULL,
  email TEXT NOT NULL,
  role TEXT DEFAULT 'viewer',
  status TEXT DEFAULT 'active',
  created_at TEXT DEFAULT (datetime('now')),
  UNIQUE(org_id, email)
);

CREATE TABLE IF NOT EXISTS asset_categories (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  org_id INTEGER NOT NULL,
  name TEXT NOT NULL,
  parent_id INTEGER,
  depreciation_method TEXT DEFAULT 'straight_line',
  useful_life_years INTEGER DEFAULT 5,
  salvage_percent REAL DEFAULT 0,
  icon TEXT,
  created_at TEXT DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_categories_org ON asset_categories(org_id);

CREATE TABLE IF NOT EXISTS locations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  org_id INTEGER NOT NULL,
  name TEXT NOT NULL,
  address TEXT,
  building TEXT,
  floor TEXT,
  room TEXT,
  gps_lat REAL,
  gps_lon REAL,
  status TEXT DEFAULT 'active',
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS assets (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  org_id INTEGER NOT NULL,
  asset_tag TEXT NOT NULL,
  name TEXT NOT NULL,
  description TEXT,
  category_id INTEGER,
  location_id INTEGER,
  assigned_to INTEGER,
  serial_number TEXT,
  model TEXT,
  manufacturer TEXT,
  purchase_date TEXT,
  purchase_price REAL DEFAULT 0,
  current_value REAL DEFAULT 0,
  salvage_value REAL DEFAULT 0,
  useful_life_months INTEGER DEFAULT 60,
  depreciation_method TEXT DEFAULT 'straight_line',
  accumulated_depreciation REAL DEFAULT 0,
  warranty_expiry TEXT,
  insurance_policy TEXT,
  insurance_expiry TEXT,
  condition TEXT DEFAULT 'good',
  barcode TEXT,
  qr_code TEXT,
  image_url TEXT,
  custom_fields JSON DEFAULT '{}',
  tags JSON DEFAULT '[]',
  status TEXT DEFAULT 'active',
  disposed_at TEXT,
  disposal_method TEXT,
  disposal_value REAL,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_assets_org ON assets(org_id);
CREATE INDEX IF NOT EXISTS idx_assets_category ON assets(category_id);
CREATE INDEX IF NOT EXISTS idx_assets_location ON assets(location_id);
CREATE INDEX IF NOT EXISTS idx_assets_assigned ON assets(assigned_to);
CREATE INDEX IF NOT EXISTS idx_assets_tag ON assets(org_id, asset_tag);
CREATE INDEX IF NOT EXISTS idx_assets_status ON assets(org_id, status);

CREATE TABLE IF NOT EXISTS depreciation_schedule (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  asset_id INTEGER NOT NULL,
  period_start TEXT NOT NULL,
  period_end TEXT NOT NULL,
  depreciation_amount REAL NOT NULL,
  accumulated REAL NOT NULL,
  book_value REAL NOT NULL,
  method TEXT NOT NULL,
  created_at TEXT DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_depreciation_asset ON depreciation_schedule(asset_id);

CREATE TABLE IF NOT EXISTS maintenance_records (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  asset_id INTEGER NOT NULL,
  type TEXT DEFAULT 'preventive',
  description TEXT,
  performed_by TEXT,
  cost REAL DEFAULT 0,
  scheduled_date TEXT,
  completed_date TEXT,
  next_due_date TEXT,
  notes TEXT,
  status TEXT DEFAULT 'scheduled',
  created_at TEXT DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_maintenance_asset ON maintenance_records(asset_id);

CREATE TABLE IF NOT EXISTS assignment_history (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  asset_id INTEGER NOT NULL,
  assigned_to INTEGER,
  assigned_by INTEGER,
  location_id INTEGER,
  action TEXT NOT NULL,
  notes TEXT,
  created_at TEXT DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_history_asset ON assignment_history(asset_id);

CREATE TABLE IF NOT EXISTS valuations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  asset_id INTEGER NOT NULL,
  valuation_date TEXT NOT NULL,
  market_value REAL,
  book_value REAL,
  replacement_cost REAL,
  appraiser TEXT,
  method TEXT,
  notes TEXT,
  created_at TEXT DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_valuations_asset ON valuations(asset_id);

CREATE TABLE IF NOT EXISTS insurance_policies (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  org_id INTEGER NOT NULL,
  policy_number TEXT NOT NULL,
  provider TEXT,
  coverage_type TEXT,
  premium REAL DEFAULT 0,
  deductible REAL DEFAULT 0,
  coverage_amount REAL DEFAULT 0,
  start_date TEXT,
  end_date TEXT,
  status TEXT DEFAULT 'active',
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS asset_insurance (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  asset_id INTEGER NOT NULL,
  policy_id INTEGER NOT NULL,
  coverage_amount REAL DEFAULT 0,
  created_at TEXT DEFAULT (datetime('now')),
  UNIQUE(asset_id, policy_id)
);

CREATE TABLE IF NOT EXISTS check_in_out (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  asset_id INTEGER NOT NULL,
  user_id INTEGER NOT NULL,
  action TEXT NOT NULL,
  condition_before TEXT,
  condition_after TEXT,
  notes TEXT,
  created_at TEXT DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_checkinout_asset ON check_in_out(asset_id);

CREATE TABLE IF NOT EXISTS reports_daily (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  org_id INTEGER NOT NULL,
  date TEXT NOT NULL,
  total_assets INTEGER DEFAULT 0,
  total_value REAL DEFAULT 0,
  total_depreciation REAL DEFAULT 0,
  assets_in_service INTEGER DEFAULT 0,
  assets_in_maintenance INTEGER DEFAULT 0,
  assets_disposed INTEGER DEFAULT 0,
  maintenance_cost REAL DEFAULT 0,
  UNIQUE(org_id, date)
);

CREATE TABLE IF NOT EXISTS activity_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  org_id INTEGER,
  actor TEXT,
  action TEXT NOT NULL,
  target TEXT,
  details TEXT,
  created_at TEXT DEFAULT (datetime('now'))
);
