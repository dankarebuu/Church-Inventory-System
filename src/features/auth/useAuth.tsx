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
import {
  clearAllOfflineCaches,
  clearOfflineCache,
  setActiveOfflineCacheUserId,
} from '@/lib/offlineCache';
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

type ProfileLookupResult =
  | { status: 'found'; profile: ProfileRecord }
  | { status: 'missing' }
  | { status: 'error' };

async function fetchProfileRow(userId: string): Promise<ProfileLookupResult> {
  const { data, error } = await supabase
    .from('profiles')
    .select('id, email, first_name, last_name, role, created_at')
    .eq('id', userId)
    .maybeSingle();

  if (error) {
    return { status: 'error' };
  }

  if (!data) {
    return { status: 'missing' };
  }

  return { status: 'found', profile: data };
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
  const pendingRecoveryRef = useRef<boolean>(false);
  const userRef = useRef<User | null>(null);
  userRef.current = user;
  const latestAuthUserRef = useRef<User | null>(null);
  const navigateRef = useRef(navigate);
  navigateRef.current = navigate;

  useEffect(() => {
    applyDocumentTheme(theme);
  }, [theme]);

  const commitAuthenticatedUser = useCallback(async (nextUser: User, seq: number) => {
    let lookup: ProfileLookupResult;
    try {
      lookup = await fetchProfileRow(nextUser.id);
    } catch {
      lookup = { status: 'error' };
    }

    if (!mountedRef.current || seq !== requestSeqRef.current) return;

    setActiveOfflineCacheUserId(nextUser.id);
    setUser(nextUser);
    setProfile((prev) => {
      if (lookup.status === 'found') return lookup.profile;
      if (lookup.status === 'missing') return null;
      return prev?.id === nextUser.id ? prev : null;
    });
    setIsLoading(false);

    if (pendingRecoveryRef.current) {
      pendingRecoveryRef.current = false;
      navigateRef.current('/reset-password');
    }
  }, []);

  const applySession = useCallback(
    async (session: Session | null, seq: number) => {
      const nextUser = session?.user ?? null;

      if (!nextUser) {
        if (!mountedRef.current || seq !== requestSeqRef.current) return;
        pendingRecoveryRef.current = false;
        latestAuthUserRef.current = null;
        setActiveOfflineCacheUserId(null);
        setUser(null);
        setProfile(null);
        setIsLoading(false);
        return;
      }

      latestAuthUserRef.current = nextUser;
      if (userRef.current?.id !== nextUser.id) {
        setIsLoading(true);
      }

      await commitAuthenticatedUser(nextUser, seq);
    },
    [commitAuthenticatedUser]
  );

  useEffect(() => {
    mountedRef.current = true;
    const initSeq = ++requestSeqRef.current;

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((event, session) => {
      const eventSeq = ++requestSeqRef.current;

      if (event === 'SIGNED_OUT') {
        pendingRecoveryRef.current = false;
        const previousUserId = userRef.current?.id ?? latestAuthUserRef.current?.id ?? null;
        if (previousUserId) {
          clearOfflineCache(previousUserId);
        }
        clearAllOfflineCaches();
        setActiveOfflineCacheUserId(null);
      } else if (!session?.user) {
        pendingRecoveryRef.current = false;
      } else if (event === 'PASSWORD_RECOVERY') {
        pendingRecoveryRef.current = true;
        setIsAuthModalOpen(false);
        setGatewayDismissed(true);
        persistGatewayDismissed(true);
      }

      void applySession(session, eventSeq);
    });

    supabase.auth
      .getSession()
      .then(({ data }) => {
        void applySession(data.session, initSeq);
      })
      .catch(() => {
        if (!mountedRef.current || initSeq !== requestSeqRef.current) return;
        pendingRecoveryRef.current = false;
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
      if (!mountedRef.current || seq !== requestSeqRef.current) return;

      const activeUser = data.session?.user ?? latestAuthUserRef.current ?? userRef.current;
      if (!activeUser) {
        pendingRecoveryRef.current = false;
        latestAuthUserRef.current = null;
        setUser(null);
        setProfile(null);
        return;
      }

      latestAuthUserRef.current = activeUser;
      await commitAuthenticatedUser(activeUser, seq);
    } catch {
      // Retain existing profile state on transient lookup errors.
    }
  }, [commitAuthenticatedUser]);

  const signOut = useCallback(async () => {
    const previousUserId = userRef.current?.id ?? latestAuthUserRef.current?.id ?? null;
    const { error } = await supabase.auth.signOut();
    if (error) {
      toast.error(error.message);
      return;
    }

    if (previousUserId) {
      clearOfflineCache(previousUserId);
    }
    clearAllOfflineCaches();
    setActiveOfflineCacheUserId(null);

    pendingRecoveryRef.current = false;
    latestAuthUserRef.current = null;
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
