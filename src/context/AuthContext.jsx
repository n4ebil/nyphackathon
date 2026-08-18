import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react'
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
  // While true, the auth-state listener leaves the user profile alone — register()
  // is the one writing it. Firebase can fire onAuthStateChanged for the same sign-up
  // more than once (e.g. a token refresh right after account creation), and each firing
  // does its own Firestore read; if that read lands before register()'s own write has
  // committed, it comes back empty and — no matter how the merge logic is written — a
  // *later* empty read can still stomp on the good data once more come in after it.
  // Deferring entirely during registration removes the race instead of trying to make
  // two independent writers commutative.
  const registeringRef = useRef(false)

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
      if (registeringRef.current) {
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
      // Accounts created before contact email was stored in Firestore (or that
      // predate this field entirely) won't have one — backfill it silently so
      // features that read it (e.g. email notifications) have somewhere to send
      // to, without forcing every existing user back into Profile first.
      if (profile && !profile.email && fbUser.email) {
        upsertUserProfile(fbUser.uid, { email: fbUser.email }).catch((err) => console.error('Could not backfill contact email.', err))
        profile = { ...profile, email: fbUser.email }
      }
      setUser({ userId: fbUser.uid, email: fbUser.email, ...profile })
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
    registeringRef.current = true
    try {
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
      // Contact email starts as the login email but is stored separately in Firestore
      // (see Profile.jsx) so it can be changed later without touching the Auth account.
      try {
        await upsertUserProfile(credential.user.uid, { ...profile, email })
      } catch (err) {
        console.error('Profile save failed after sign-up; it can be completed from the Profile page.', err)
      }
      setUser({ userId: credential.user.uid, email, ...profile })
    } finally {
      registeringRef.current = false
    }
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
