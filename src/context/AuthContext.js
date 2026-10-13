import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
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

  const loadCurrentProfile =
    useCallback(async () => {
      setProfileError("");

      try {
        const currentProfile =
          await authService
            .getCurrentUserProfile();

        setProfile(
          currentProfile || null
        );

        return (
          currentProfile ||
          null
        );
      } catch (error) {
        setProfile(null);

        setProfileError(
          error?.message ||
            "Your user profile could not be loaded."
        );

        throw error;
      }
    }, []);

  const refreshProfile =
    useCallback(async () => {
      const currentUser =
        authService
          .getCurrentUser();

      if (!currentUser) {
        setUser(null);
        setProfile(null);
        setProfileError("");

        return null;
      }

      setUser(
        currentUser
      );

      setLoading(true);

      try {
        return await loadCurrentProfile();
      } finally {
        setLoading(false);
      }
    }, [loadCurrentProfile]);

  
  const updateProfileCache = useCallback((updates) => {
    setProfile((currentProfile) => {
      if (!currentProfile) {
        return currentProfile;
      }

      return {
        ...currentProfile,
        ...updates,
      };
    });
  }, []);

  
  useEffect(() => {
    let active = true;

    const unsubscribe =
      authService
        .subscribeToAuthState(
          async (
            currentUser
          ) => {
            if (!active) {
              return;
            }

            setUser(
              currentUser
            );

            setProfileError("");

            if (!currentUser) {
              setProfile(null);
              setLoading(false);

              return;
            }

            setLoading(true);

            try {
              const currentProfile =
                await authService
                  .getCurrentUserProfile();

              if (!active) {
                return;
              }

              setProfile(
                currentProfile ||
                  null
              );
            } catch (error) {
              if (!active) {
                return;
              }

              setProfile(null);

              setProfileError(
                error?.message ||
                  "Your user profile could not be loaded."
              );
            } finally {
              if (active) {
                setLoading(
                  false
                );
              }
            }
          }
        );

    return () => {
      active = false;
      unsubscribe();
    };
  }, []);

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