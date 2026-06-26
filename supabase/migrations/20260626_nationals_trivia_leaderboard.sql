CREATE TABLE public.nationals_trivia_scores (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name        text NOT NULL CHECK (char_length(btrim(name)) BETWEEN 1 AND 12),
  score       integer NOT NULL CHECK (score BETWEEN 0 AND 150),
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_nationals_trivia_scores_score
  ON public.nationals_trivia_scores (score DESC, created_at ASC);

ALTER TABLE public.nationals_trivia_scores ENABLE ROW LEVEL SECURITY;

CREATE POLICY "trivia_scores_select" ON public.nationals_trivia_scores
  FOR SELECT TO anon, authenticated USING (true);

CREATE POLICY "trivia_scores_insert" ON public.nationals_trivia_scores
  FOR INSERT TO anon, authenticated WITH CHECK (true);

REVOKE UPDATE, DELETE ON public.nationals_trivia_scores FROM anon, authenticated;
