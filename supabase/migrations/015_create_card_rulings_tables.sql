-- Card rulings: official rulings/FAQs attached to cards
CREATE TABLE card_rulings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  card_name TEXT NOT NULL,
  question TEXT NOT NULL,
  answer TEXT NOT NULL,
  source TEXT DEFAULT 'manual',
  source_url TEXT,
  ruling_date DATE,
  created_by UUID REFERENCES auth.users(id),
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- Discord messages staging table for ruling sync
CREATE TABLE discord_ruling_messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  discord_message_id TEXT UNIQUE NOT NULL,
  author_name TEXT,
  content TEXT NOT NULL,
  message_date TIMESTAMPTZ NOT NULL,
  status TEXT DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'skipped')),
  suggested_card_name TEXT,
  processed_by UUID REFERENCES auth.users(id),
  processed_at TIMESTAMPTZ,
  ruling_id UUID REFERENCES card_rulings(id),
  created_at TIMESTAMPTZ DEFAULT now()
);

-- Indexes for performance
CREATE INDEX idx_card_rulings_card_name ON card_rulings(card_name);
CREATE INDEX idx_card_rulings_search ON card_rulings USING gin(to_tsvector('english', question || ' ' || answer || ' ' || card_name));
CREATE INDEX idx_discord_messages_status ON discord_ruling_messages(status);
CREATE INDEX idx_discord_messages_message_id ON discord_ruling_messages(discord_message_id);

-- RLS policies
ALTER TABLE card_rulings ENABLE ROW LEVEL SECURITY;
ALTER TABLE discord_ruling_messages ENABLE ROW LEVEL SECURITY;

-- Anyone can read rulings
CREATE POLICY "Anyone can read rulings" ON card_rulings
  FOR SELECT USING (true);

-- Only admins can insert/update/delete rulings
CREATE POLICY "Admins can insert rulings" ON card_rulings
  FOR INSERT WITH CHECK (
    EXISTS (SELECT 1 FROM admin_users WHERE user_id = auth.uid())
  );

CREATE POLICY "Admins can update rulings" ON card_rulings
  FOR UPDATE USING (
    EXISTS (SELECT 1 FROM admin_users WHERE user_id = auth.uid())
  );

CREATE POLICY "Admins can delete rulings" ON card_rulings
  FOR DELETE USING (
    EXISTS (SELECT 1 FROM admin_users WHERE user_id = auth.uid())
  );

-- Only admins can access discord staging messages
CREATE POLICY "Admins can read discord messages" ON discord_ruling_messages
  FOR SELECT USING (
    EXISTS (SELECT 1 FROM admin_users WHERE user_id = auth.uid())
  );

CREATE POLICY "Admins can insert discord messages" ON discord_ruling_messages
  FOR INSERT WITH CHECK (
    EXISTS (SELECT 1 FROM admin_users WHERE user_id = auth.uid())
  );

CREATE POLICY "Admins can update discord messages" ON discord_ruling_messages
  FOR UPDATE USING (
    EXISTS (SELECT 1 FROM admin_users WHERE user_id = auth.uid())
  );
