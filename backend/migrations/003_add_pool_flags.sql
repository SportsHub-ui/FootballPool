-- Add default_flg and sign_in_req_flg columns to pool table
ALTER TABLE football_pool.pool
  ADD COLUMN IF NOT EXISTS default_flg BOOLEAN DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS sign_in_req_flg BOOLEAN DEFAULT FALSE;
