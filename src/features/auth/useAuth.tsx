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
import { flushSync } from 'react-dom';
import { QueryClientContext } from '@tanstack/react-query';
import type { Session, User } from '@supabase/supabase-js';
import { useLocation, useNavigate } from 'react-router-dom';
import {
  clearAllOfflineCaches,
  clearOfflineCache,
  setActiveOfflineCacheUserId,
} from '@/lib/offlineCache';
import { clearPrivateQueries } from '@/lib/queryKeys';
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
  toggleTheme: (originOrEvent?: unknown) => void;
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
    document
      .querySelector('meta[name="color-scheme"]')
      ?.setAttribute('content', theme);
    document
      .querySelector('meta[name="theme-color"]')
      ?.setAttribute('content', theme === 'dark' ? '#0B0F17' : '#F8FAFC');
  }
  try {
    if (typeof window !== 'undefined') {
      window.localStorage.setItem(THEME_STORAGE_KEY, theme);
    }
  } catch {
    // Ignore storage write errors in restricted browser contexts.
  }
}

interface ViewTransitionLike {
  ready: Promise<unknown>;
  finished: Promise<unknown>;
}

function resolveThemeToggleOrigin(source?: unknown): { x: number; y: number } {
  if (typeof window === 'undefined') return { x: 0, y: 0 };

  if (source && typeof source === 'object') {
    const candidate = source as {
      x?: number;
      y?: number;
      clientX?: number;
      clientY?: number;
      currentTarget?: { getBoundingClientRect?: () => DOMRect } | null;
    };
    if (typeof candidate.x === 'number' && typeof candidate.y === 'number') {
      return { x: candidate.x, y: candidate.y };
    }
    if (
      typeof candidate.clientX === 'number' &&
      typeof candidate.clientY === 'number' &&
      (candidate.clientX > 0 || candidate.clientY > 0)
    ) {
      return { x: candidate.clientX, y: candidate.clientY };
    }
    const targetRect = candidate.currentTarget?.getBoundingClientRect?.();
    if (targetRect && targetRect.width > 0 && targetRect.height > 0) {
      return {
        x: targetRect.left + targetRect.width / 2,
        y: targetRect.top + targetRect.height / 2,
      };
    }
  }

  if (typeof document !== 'undefined') {
    const toggleBtn = document.querySelector<HTMLElement>('[data-theme-toggle]');
    const rect = toggleBtn?.getBoundingClientRect();
    if (rect && rect.width > 0 && rect.height > 0) {
      return {
        x: rect.left + rect.width / 2,
        y: rect.top + rect.height / 2,
      };
    }
  }

  return { x: Math.max(window.innerWidth - 72, 0), y: 32 };
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
  const queryClient = useContext(QueryClientContext);
  const queryClientRef = useRef(queryClient);
  queryClientRef.current = queryClient;

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
  const themeRef = useRef<ThemeMode>(theme);
  themeRef.current = theme;
  const themeTransitionSeqRef = useRef<number>(0);
  const fadeTimeoutRef = useRef<number | null>(null);
  const latestAuthUserRef = useRef<User | null>(null);
  const navigateRef = useRef(navigate);
  navigateRef.current = navigate;

  useEffect(() => {
    applyDocumentTheme(theme);
  }, [theme]);

  useEffect(() => {
    return () => {
      if (fadeTimeoutRef.current !== null && typeof window !== 'undefined') {
        window.clearTimeout(fadeTimeoutRef.current);
      }
    };
  }, []);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const handleStorage = (event: StorageEvent) => {
      if (event.key !== THEME_STORAGE_KEY) return;
      if (event.newValue === 'dark' || event.newValue === 'light') {
        setTheme(event.newValue);
      }
    };
    window.addEventListener('storage', handleStorage);
    return () => window.removeEventListener('storage', handleStorage);
  }, []);

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
        if (queryClientRef.current) {
          clearPrivateQueries(queryClientRef.current);
        }
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

  const toggleTheme = useCallback((originOrEvent?: unknown) => {
    const nextTheme: ThemeMode = themeRef.current === 'dark' ? 'light' : 'dark';
    const commitTheme = (syncDom: boolean) => {
      themeRef.current = nextTheme;
      applyDocumentTheme(nextTheme);
      if (syncDom) {
        flushSync(() => {
          setTheme(nextTheme);
        });
      } else {
        setTheme(nextTheme);
      }
    };

    if (typeof document === 'undefined') {
      commitTheme(false);
      return;
    }

    const root = document.documentElement;
    const prefersReducedMotion =
      typeof window !== 'undefined' &&
      typeof window.matchMedia === 'function' &&
      window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const transitionSeq = ++themeTransitionSeqRef.current;

    if (fadeTimeoutRef.current !== null && typeof window !== 'undefined') {
      window.clearTimeout(fadeTimeoutRef.current);
      fadeTimeoutRef.current = null;
    }

    const docWithViewTransition = document as Document & {
      startViewTransition?: (callback: () => void) => ViewTransitionLike;
    };

    if (!prefersReducedMotion && typeof docWithViewTransition.startViewTransition === 'function') {
      const origin = resolveThemeToggleOrigin(originOrEvent);
      const endRadius = Math.hypot(
        Math.max(origin.x, window.innerWidth - origin.x),
        Math.max(origin.y, window.innerHeight - origin.y)
      );

      root.setAttribute('data-theme-transition', 'ripple');
      root.setAttribute('data-theme-switching', 'true');

      try {
        const transition = docWithViewTransition.startViewTransition(() => {
          commitTheme(true);
        });

        Promise.resolve(transition.ready)
          .then(() => {
            if (transitionSeq !== themeTransitionSeqRef.current) return;
            root.removeAttribute('data-theme-switching');
            root.animate?.(
              {
                clipPath: [
                  `circle(0px at ${origin.x}px ${origin.y}px)`,
                  `circle(${endRadius}px at ${origin.x}px ${origin.y}px)`,
                ],
              },
              {
                duration: 380,
                easing: 'cubic-bezier(0.22, 1, 0.36, 1)',
                pseudoElement: '::view-transition-new(root)',
              }
            );
          })
          .catch(() => {
            if (transitionSeq === themeTransitionSeqRef.current) {
              root.removeAttribute('data-theme-switching');
            }
          });

        Promise.resolve(transition.finished)
          .catch(() => {
            // Ignore superseded or aborted transitions.
          })
          .finally(() => {
            if (transitionSeq === themeTransitionSeqRef.current) {
              root.removeAttribute('data-theme-switching');
              root.removeAttribute('data-theme-transition');
            }
          });
      } catch {
        root.removeAttribute('data-theme-switching');
        root.removeAttribute('data-theme-transition');
        commitTheme(false);
      }
      return;
    }

    if (!prefersReducedMotion) {
      root.removeAttribute('data-theme-switching');
      root.setAttribute('data-theme-transition', 'fade');
      commitTheme(false);
      if (typeof window !== 'undefined') {
        fadeTimeoutRef.current = window.setTimeout(() => {
          if (transitionSeq === themeTransitionSeqRef.current) {
            root.removeAttribute('data-theme-transition');
          }
          fadeTimeoutRef.current = null;
        }, 260);
      }
      return;
    }

    root.removeAttribute('data-theme-transition');
    root.setAttribute('data-theme-switching', 'true');
    commitTheme(false);
    const clearFlag = () => {
      if (transitionSeq === themeTransitionSeqRef.current) {
        root.removeAttribute('data-theme-switching');
      }
    };
    if (typeof window !== 'undefined' && typeof window.requestAnimationFrame === 'function') {
      window.requestAnimationFrame(() => window.requestAnimationFrame(clearFlag));
    } else {
      setTimeout(clearFlag, 0);
    }
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
    const purgeOfflineState = () => {
      if (previousUserId) {
        clearOfflineCache(previousUserId);
      }
      clearAllOfflineCaches();
      setActiveOfflineCacheUserId(null);
      if (queryClientRef.current) {
        clearPrivateQueries(queryClientRef.current);
      }
    };

    // Purge cached catalog data and scope immediately so sign-out never leaves cached data behind
    // even if remote revocation is slow, errors, or the device is offline.
    purgeOfflineState();

    let remoteFailed = false;
    try {
      const { error } = await supabase.auth.signOut();
      if (error) {
        remoteFailed = true;
      }
    } catch {
      remoteFailed = true;
    }

    if (remoteFailed) {
      try {
        await supabase.auth.signOut({ scope: 'local' });
      } catch {
        // Offline or storage edge cases must never trap a user in a signed-in session.
      }
    }

    purgeOfflineState();
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
