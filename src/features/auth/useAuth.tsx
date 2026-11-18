import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import type { Session, User } from '@supabase/supabase-js';
import { useLocation, useNavigate } from 'react-router-dom';
import { toast } from 'sonner';
import { supabase } from '@/lib/supabase';
import type { ProfileRecord, UserRole } from '@/types/database';

export const THEME_STORAGE_KEY = 'wingmacc_theme';
export const GATEWAY_DISMISSED_KEY = 'wingmacc_gateway_dismissed';

export type ThemeMode = 'light' | 'dark';
export type AuthModalMode = 'login' | 'signup' | 'forgot';

export interface AuthContextValue {
  user: User | null;
  profile: ProfileRecord | null;
  role: UserRole;
  isLoading: boolean;
  theme: ThemeMode;
  toggleTheme: () => void;
  showGateway: boolean;
  dismissGateway: () => void;
  openAuthModal: (mode?: AuthModalMode) => void;
  closeAuthModal: () => void;
  isAuthModalOpen: boolean;
  authModalMode: AuthModalMode;
  setAuthModalMode: (mode: AuthModalMode) => void;
  signOut: () => Promise<void>;
  refreshProfile: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

function readInitialTheme(): ThemeMode {
  try {
    if (typeof window !== 'undefined' && window.localStorage.getItem(THEME_STORAGE_KEY) === 'dark') {
      return 'dark';
    }
  } catch {
    // Ignore storage read errors in restricted browser contexts.
  }
  if (typeof document !== 'undefined' && document.documentElement.getAttribute('data-theme') === 'dark') {
    return 'dark';
  }
  return 'light';
}

function readGatewayDismissed(): boolean {
  try {
    if (typeof window !== 'undefined') {
      return window.sessionStorage.getItem(GATEWAY_DISMISSED_KEY) === 'true';
    }
  } catch {
    // Ignore storage read errors in restricted browser contexts.
  }
  return false;
}

function persistGatewayDismissed(dismissed: boolean): void {
  try {
    if (typeof window === 'undefined') return;
    if (dismissed) {
      window.sessionStorage.setItem(GATEWAY_DISMISSED_KEY, 'true');
    } else {
      window.sessionStorage.removeItem(GATEWAY_DISMISSED_KEY);
    }
  } catch {
    // Ignore storage write errors in restricted browser contexts.
  }
}

function applyDocumentTheme(theme: ThemeMode): void {
  if (typeof document !== 'undefined') {
    document.documentElement.setAttribute('data-theme', theme);
  }
  try {
    if (typeof window !== 'undefined') {
      window.localStorage.setItem(THEME_STORAGE_KEY, theme);
    }
  } catch {
    // Ignore storage write errors in restricted browser contexts.
  }
}

async function fetchProfileRow(userId: string): Promise<ProfileRecord | null> {
  const { data, error } = await supabase
    .from('profiles')
    .select('id, email, first_name, last_name, role, created_at')
    .eq('id', userId)
    .maybeSingle();

  if (error || !data) {
    return null;
  }

  return data;
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const navigate = useNavigate();
  const location = useLocation();

  const [user, setUser] = useState<User | null>(null);
  const [profile, setProfile] = useState<ProfileRecord | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [theme, setTheme] = useState<ThemeMode>(readInitialTheme);
  const [gatewayDismissed, setGatewayDismissed] = useState<boolean>(readGatewayDismissed);
  const [isAuthModalOpen, setIsAuthModalOpen] = useState<boolean>(false);
  const [authModalMode, setAuthModalMode] = useState<AuthModalMode>('login');

  const mountedRef = useRef<boolean>(true);
  const requestSeqRef = useRef<number>(0);
  const userRef = useRef<User | null>(null);
  userRef.current = user;
  const navigateRef = useRef(navigate);
  navigateRef.current = navigate;

  useEffect(() => {
    applyDocumentTheme(theme);
  }, [theme]);

  const applySession = useCallback(async (session: Session | null, seq: number) => {
    const nextUser = session?.user ?? null;

    if (!nextUser) {
      if (!mountedRef.current || seq !== requestSeqRef.current) return;
      setUser(null);
      setProfile(null);
      setIsLoading(false);
      return;
    }

    if (userRef.current?.id !== nextUser.id) {
      setIsLoading(true);
    }

    let nextProfile: ProfileRecord | null = null;
    try {
      nextProfile = await fetchProfileRow(nextUser.id);
    } catch {
      nextProfile = null;
    }

    if (!mountedRef.current || seq !== requestSeqRef.current) return;
    setUser(nextUser);
    setProfile(nextProfile);
    setIsLoading(false);
  }, []);

  useEffect(() => {
    mountedRef.current = true;
    const initSeq = ++requestSeqRef.current;

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((event, session) => {
      const eventSeq = ++requestSeqRef.current;
      const applyPromise = applySession(session, eventSeq);

      if (event === 'PASSWORD_RECOVERY') {
        setIsAuthModalOpen(false);
        setGatewayDismissed(true);
        persistGatewayDismissed(true);
        void applyPromise.then(() => {
          if (mountedRef.current && eventSeq === requestSeqRef.current) {
            navigateRef.current('/reset-password');
          }
        });
      }
    });

    supabase.auth
      .getSession()
      .then(({ data }) => {
        void applySession(data.session, initSeq);
      })
      .catch(() => {
        if (!mountedRef.current || initSeq !== requestSeqRef.current) return;
        setUser(null);
        setProfile(null);
        setIsLoading(false);
      });

    return () => {
      mountedRef.current = false;
      subscription.unsubscribe();
    };
  }, [applySession]);

  const toggleTheme = useCallback(() => {
    setTheme((prev) => {
      const next: ThemeMode = prev === 'dark' ? 'light' : 'dark';
      applyDocumentTheme(next);
      return next;
    });
  }, []);

  const dismissGateway = useCallback(() => {
    setGatewayDismissed(true);
    persistGatewayDismissed(true);
  }, []);

  const openAuthModal = useCallback((mode: AuthModalMode = 'login') => {
    setAuthModalMode(mode);
    setIsAuthModalOpen(true);
  }, []);

  const closeAuthModal = useCallback(() => {
    setIsAuthModalOpen(false);
  }, []);

  const refreshProfile = useCallback(async () => {
    const seq = ++requestSeqRef.current;
    try {
      const { data } = await supabase.auth.getSession();
      const activeUser = data.session?.user ?? userRef.current;

      if (!activeUser) {
        if (mountedRef.current && seq === requestSeqRef.current) {
          setUser(null);
          setProfile(null);
        }
        return;
      }

      const nextProfile = await fetchProfileRow(activeUser.id);
      if (!mountedRef.current || seq !== requestSeqRef.current) return;

      setUser(activeUser);
      setProfile(nextProfile);
    } catch {
      // Retain existing profile state on transient lookup errors.
    }
  }, []);

  const signOut = useCallback(async () => {
    const { error } = await supabase.auth.signOut();
    if (error) {
      toast.error(error.message);
      return;
    }

    ++requestSeqRef.current;
    setUser(null);
    setProfile(null);
    setGatewayDismissed(false);
    persistGatewayDismissed(false);
  }, []);

  const role: UserRole = !user
    ? 'guest'
    : profile?.role === 'admin'
      ? 'admin'
      : 'member';

  const showGateway =
    !isLoading &&
    user === null &&
    !gatewayDismissed &&
    location.pathname !== '/reset-password';

  const value = useMemo<AuthContextValue>(
    () => ({
      user,
      profile,
      role,
      isLoading,
      theme,
      toggleTheme,
      showGateway,
      dismissGateway,
      openAuthModal,
      closeAuthModal,
      isAuthModalOpen,
      authModalMode,
      setAuthModalMode,
      signOut,
      refreshProfile,
    }),
    [
      user,
      profile,
      role,
      isLoading,
      theme,
      toggleTheme,
      showGateway,
      dismissGateway,
      openAuthModal,
      closeAuthModal,
      isAuthModalOpen,
      authModalMode,
      signOut,
      refreshProfile,
    ]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return ctx;
}
