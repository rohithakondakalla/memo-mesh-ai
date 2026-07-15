
-- ============ profiles ============
CREATE TABLE public.profiles (
  id UUID NOT NULL PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  display_name TEXT,
  avatar_url TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.profiles TO authenticated;
GRANT ALL ON public.profiles TO service_role;

ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users manage own profile" ON public.profiles
  FOR ALL USING (auth.uid() = id) WITH CHECK (auth.uid() = id);

CREATE TRIGGER update_profiles_updated_at
  BEFORE UPDATE ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- Auto-create profile on signup
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.profiles (id, display_name)
  VALUES (NEW.id, COALESCE(NEW.raw_user_meta_data->>'full_name', split_part(NEW.email, '@', 1)))
  ON CONFLICT (id) DO NOTHING;
  RETURN NEW;
END;
$$;

CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- ============ memory_events ============
CREATE TABLE public.memory_events (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  description TEXT,
  event_type TEXT,
  start_date DATE,
  end_date DATE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.memory_events TO authenticated;
GRANT ALL ON public.memory_events TO service_role;

ALTER TABLE public.memory_events ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users manage own memory events" ON public.memory_events
  FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

CREATE TRIGGER update_memory_events_updated_at
  BEFORE UPDATE ON public.memory_events
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE INDEX memory_events_user_idx ON public.memory_events(user_id);

-- ============ documents: extend with AI metadata ============
ALTER TABLE public.documents
  ADD COLUMN doc_type TEXT,
  ADD COLUMN category TEXT,
  ADD COLUMN people TEXT[] NOT NULL DEFAULT '{}',
  ADD COLUMN organizations TEXT[] NOT NULL DEFAULT '{}',
  ADD COLUMN locations TEXT[] NOT NULL DEFAULT '{}',
  ADD COLUMN keywords TEXT[] NOT NULL DEFAULT '{}',
  ADD COLUMN action_items TEXT[] NOT NULL DEFAULT '{}',
  ADD COLUMN important_dates JSONB NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN event_id UUID REFERENCES public.memory_events(id) ON DELETE SET NULL;

CREATE INDEX documents_event_idx ON public.documents(event_id);

-- ============ memory_connections ============
CREATE TABLE public.memory_connections (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  doc_a UUID NOT NULL REFERENCES public.documents(id) ON DELETE CASCADE,
  doc_b UUID NOT NULL REFERENCES public.documents(id) ON DELETE CASCADE,
  relation TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT memory_connections_distinct CHECK (doc_a <> doc_b),
  CONSTRAINT memory_connections_unique_pair UNIQUE (doc_a, doc_b)
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.memory_connections TO authenticated;
GRANT ALL ON public.memory_connections TO service_role;

ALTER TABLE public.memory_connections ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users manage own connections" ON public.memory_connections
  FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

CREATE INDEX memory_connections_user_idx ON public.memory_connections(user_id);
CREATE INDEX memory_connections_doc_a_idx ON public.memory_connections(doc_a);
CREATE INDEX memory_connections_doc_b_idx ON public.memory_connections(doc_b);
