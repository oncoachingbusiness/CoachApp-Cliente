import type { Session } from '@supabase/supabase-js';
import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';

import { supabase } from '@/lib/supabase';

type Client = {
  id: string;
  user_id: string;
  name: string;
  [key: string]: unknown;
};

type AuthContextValue = {
  session: Session | null;
  client: Client | null;
  loading: boolean;
  signIn: (email: string, password: string) => Promise<{ error: string | null }>;
  refreshClient: () => Promise<void>;
};

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

async function fetchClient(userId: string): Promise<Client | null> {
  const { data, error } = await supabase.from('clients').select('*').eq('user_id', userId).single();
  console.log('[fetchClient] userId:', userId, 'data:', data, 'error:', error);
  return (data as Client) ?? null;
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [client, setClient] = useState<Client | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    supabase.auth.getSession().then(async ({ data }) => {
      setSession(data.session);
      if (data.session) {
        setClient(await fetchClient(data.session.user.id));
      }
      setLoading(false);
    });

    const { data: listener } = supabase.auth.onAuthStateChange(async (_event, newSession) => {
      setSession(newSession);
      setClient(newSession ? await fetchClient(newSession.user.id) : null);
    });

    return () => listener.subscription.unsubscribe();
  }, []);

  async function signIn(email: string, password: string) {
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    return { error: error ? error.message : null };
  }

  async function refreshClient() {
    if (!session) return;
    setClient(await fetchClient(session.user.id));
  }

  return (
    <AuthContext.Provider value={{ session, client, loading, signIn, refreshClient }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth debe usarse dentro de <AuthProvider>');
  }
  return context;
}
