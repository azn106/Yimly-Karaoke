ALTER TABLE queue_items ADD COLUMN controller_id text REFERENCES controllers(id) ON DELETE SET NULL;
