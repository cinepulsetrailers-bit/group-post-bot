
CREATE TABLE public.reactions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  tg_chat_id bigint NOT NULL,
  tg_message_id bigint NOT NULL,
  chat_title text,
  from_id bigint,
  from_name text,
  emoji text NOT NULL,
  action text NOT NULL DEFAULT 'add',
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, tg_chat_id, tg_message_id, from_id, emoji)
);

ALTER TABLE public.reactions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "own reactions all" ON public.reactions
  FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

CREATE INDEX idx_reactions_user_chat ON public.reactions (user_id, tg_chat_id, created_at DESC);
CREATE INDEX idx_messages_user_chat_created ON public.messages (user_id, tg_chat_id, created_at DESC);

ALTER PUBLICATION supabase_realtime ADD TABLE public.reactions;
