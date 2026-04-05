CREATE TABLE IF NOT EXISTS football_pool.uploaded_image (
  id INTEGER PRIMARY KEY,
  file_name VARCHAR NOT NULL,
  original_name VARCHAR,
  content_type VARCHAR NOT NULL,
  image_data BYTEA NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT NOW()
);
