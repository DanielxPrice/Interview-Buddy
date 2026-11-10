import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
} from "react";

import { authService } from "../services/authService";

const AuthContext =
  createContext({
    user: null,
    profile: null,
    passwordLinked: false,
    profileComplete: false,
    profileError: "",
    loading: true,
    refreshProfile:
      async () => null,
    updateProfileCache: () => {},
  });

function hasPasswordProvider(
  user
) {
  return Boolean(
    user?.providerIds?.includes(
      "password"
    )
  );
}

export function AuthProvider({
  children,
}) {
  const [user, setUser] =
    useState(null);

  const [profile, setProfile] =
    useState(null);

  const [
    profileError,
    setProfileError,
  ] = useState("");

  const [loading, setLoading] =
    useState(true);

  // Auth callbacks and manual refreshes share a revision. A slow "missing"
  // response from sign-in must never replace a completed setup's profile.
  const revision = useRef(0);
  const active = useRef(true);

  const loadProfile = useCallback(async (currentUser) => {
    const request = ++revision.current;
    setUser(currentUser);
    setProfileError("");
    if (!currentUser) {
      setProfile(null);
      setLoading(false);
      return null;
    }
    setLoading(true);
    try {
      const currentProfile = await authService.getCurrentUserProfile();
      if (!active.current || request !== revision.current) return null;
      setProfile(currentProfile || null);
      const latestUser = authService.getCurrentUser();
      const resolvedUser = latestUser?.uid === currentUser.uid ? latestUser : currentUser;
      setUser({ ...resolvedUser, username: currentProfile?.username || resolvedUser.username });
      return currentProfile || null;
    } catch (error) {
      if (!active.current || request !== revision.current) return null;
      setProfile(null);
      setProfileError(error?.message || "Your user profile could not be loaded.");
      throw error;
    } finally {
      if (active.current && request === revision.current) setLoading(false);
    }
  }, []);

  const refreshProfile = useCallback(
    () => loadProfile(authService.getCurrentUser()), [loadProfile]
  );

  const updateProfileCache = useCallback((updates) => {
    setProfile((current) => current ? { ...current, ...updates } : current);
    if (updates.username) setUser((current) => current ? { ...current, username: updates.username } : current);
  }, []);

  useEffect(() => {
    active.current = true;
    const unsubscribe = authService.subscribeToAuthState(async (currentUser) => {
      try {
        await loadProfile(currentUser);
      } catch {
        // loadProfile exposes the error through context for retry UI.
      }
    });
    return () => {
      active.current = false;
      revision.current += 1;
      unsubscribe();
    };
  }, [loadProfile]);

  const passwordLinked =
    hasPasswordProvider(
      user
    );

  const profileComplete =
    Boolean(profile) &&
    passwordLinked;

  return (
    <AuthContext.Provider
      value={{
        user,
        profile,
        passwordLinked,
        profileComplete,
        profileError,
        loading,
        refreshProfile,
        updateProfileCache,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  return useContext(
    AuthContext
  );
}

export default AuthContext;