-- Add default_flg and sign_in_req_flg columns to pool table
ALTER TABLE football_pool.pool
ADD COLUMN default_flg BOOLEAN DEFAULT FALSE,
ADD COLUMN sign_in_req_flg BOOLEAN DEFAULT FALSE;
