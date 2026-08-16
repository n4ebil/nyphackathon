import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react'
import {
  createUserWithEmailAndPassword,
  onAuthStateChanged,
  signInWithEmailAndPassword,
  signOut,
  updateProfile as updateAuthProfile,
} from 'firebase/auth'
import { auth, isFirebaseConfigured } from '../firebase.js'
import { getUserProfile, upsertUserProfile } from '../lib/firestore.js'
import { isAdminEmail } from '../lib/admin.js'

const AuthContext = createContext(null)

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (!isFirebaseConfigured) {
      setLoading(false)
      return
    }
    const unsubscribe = onAuthStateChanged(auth, async (fbUser) => {
      if (!fbUser) {
        setUser(null)
        setLoading(false)
        return
      }
      let profile = null
      try {
        profile = await getUserProfile(fbUser.uid)
      } catch (err) {
        console.error('Could not load profile from Firestore.', err)
      }
      if (profile?.locked) {
        await signOut(auth)
        setUser(null)
        setLoading(false)
        return
      }
      // A failed/empty fetch shouldn't erase profile fields `register()` already set
      // locally (e.g. while this same listener fires from the sign-up itself).
      setUser((prev) => ({ userId: fbUser.uid, email: fbUser.email, ...(prev?.userId === fbUser.uid ? prev : null), ...profile }))
      setLoading(false)
    })
    return unsubscribe
  }, [])

  const login = useCallback(async (email, password) => {
    let credential
    try {
      credential = await signInWithEmailAndPassword(auth, email, password)
    } catch (err) {
      throw new Error(friendlyAuthError(err))
    }
    const profile = await getUserProfile(credential.user.uid).catch(() => null)
    if (profile?.locked) {
      await signOut(auth)
      throw new Error('This account has been locked.')
    }
    if (!profile) {
      await signOut(auth)
      throw new Error('This account no longer exists.')
    }
  }, [])

  const register = useCallback(async ({ email, password, ...profile }) => {
    let credential
    try {
      credential = await createUserWithEmailAndPassword(auth, email, password)
      await updateAuthProfile(credential.user, { displayName: profile.name })
    } catch (err) {
      throw new Error(friendlyAuthError(err))
    }
    // The Auth account exists past this point — don't fail the whole sign-up over a
    // Firestore write hiccup (e.g. rules not deployed yet), or a retry would just hit
    // "email already in use" with no way to finish setting up the profile.
    try {
      await upsertUserProfile(credential.user.uid, profile)
    } catch (err) {
      console.error('Profile save failed after sign-up; it can be completed from the Profile page.', err)
    }
    setUser({ userId: credential.user.uid, email, ...profile })
  }, [])

  const logout = useCallback(() => signOut(auth), [])

  const refreshProfile = useCallback(async () => {
    if (!auth.currentUser) return
    const profile = await getUserProfile(auth.currentUser.uid)
    setUser({ userId: auth.currentUser.uid, email: auth.currentUser.email, ...profile })
  }, [])

  const value = useMemo(
    () => ({
      user,
      loading,
      configured: isFirebaseConfigured,
      isAdmin: isAdminEmail(user?.email),
      login,
      register,
      logout,
      refreshProfile,
    }),
    [user, loading, login, register, logout, refreshProfile],
  )

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export function useAuth() {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth must be used inside <AuthProvider>')
  return ctx
}

function friendlyAuthError(err) {
  const code = err?.code || ''
  if (code.includes('email-already-in-use')) return 'That email is already registered — try signing in instead.'
  if (code.includes('invalid-credential') || code.includes('wrong-password') || code.includes('user-not-found'))
    return 'Incorrect email or password.'
  if (code.includes('weak-password')) return 'Password should be at least 6 characters.'
  if (code.includes('invalid-email')) return 'Enter a valid email address.'
  if (code.includes('api-key-not-valid') || code.includes('invalid-api-key'))
    return 'Firebase is not configured yet — see the setup banner below.'
  return err?.message || 'Something went wrong. Please try again.'
}
