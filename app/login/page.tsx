'use client';

/**
 * app/login/page.tsx — direct port of frontend/login.html.
 * Same fields, same validation message, same error message extraction,
 * same redirect-if-already-logged-in behavior, same sessionStorage keys.
 */

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { getToken } from '@/lib/api-client';

export default function LoginPage() {
  const router = useRouter();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const passwordRef = useRef<HTMLInputElement>(null);

  // Forgot-password flow: 'login' -> 'request' (enter username/email) -> 'verify' (OTP + new password)
  const [mode, setMode] = useState<'login' | 'request' | 'verify'>('login');
  const [identifier, setIdentifier] = useState('');
  const [otp, setOtp] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [info, setInfo] = useState('');

  useEffect(() => {
    if (getToken()) {
      router.replace('/dashboard');
    }
  }, [router]);

  async function doLogin() {
    const u = username.trim();
    const p = password;
    setError('');

    if (!u || !p) {
      setError('Please enter username and password.');
      return;
    }

    setSubmitting(true);
    try {
      const res = await fetch(window.location.origin + '/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: u, password: p }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || data.message || 'Login failed');

      sessionStorage.setItem('token', data.token);
      sessionStorage.setItem('user', JSON.stringify(data.user));
      router.push('/dashboard');
    } catch (err: any) {
      setError(err.message);
      setSubmitting(false);
    }
  }

  function switchMode(next: 'login' | 'request' | 'verify') {
    setMode(next);
    setError('');
    setInfo('');
  }

  async function requestOtp() {
    setError('');
    setInfo('');
    const id = identifier.trim();
    if (!id) {
      setError('Enter your username or email.');
      return;
    }
    setSubmitting(true);
    try {
      const res = await fetch('/api/auth/forgot-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ identifier: id }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || data.message || 'Request failed');
      setMode('verify');
      setInfo(data.message);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setSubmitting(false);
    }
  }

  async function resetPassword() {
    setError('');
    setInfo('');
    if (!otp.trim() || !newPassword) {
      setError('Enter the code and a new password.');
      return;
    }
    if (newPassword.length < 6) {
      setError('Password must be at least 6 characters.');
      return;
    }
    if (newPassword !== confirmPassword) {
      setError('Passwords do not match.');
      return;
    }
    setSubmitting(true);
    try {
      const res = await fetch('/api/auth/reset-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ identifier: identifier.trim(), otp: otp.trim(), new_password: newPassword }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || data.message || 'Reset failed');
      setOtp('');
      setNewPassword('');
      setConfirmPassword('');
      setMode('login');
      setUsername(identifier.includes('@') ? '' : identifier.trim());
      setInfo(data.message);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setSubmitting(false);
    }
  }

  if (mode !== 'login') {
    return (
      <div className="login-page">
        <div className="login-box">
          <div className="login-logo">
            <img src="/icon-192.png" alt="" width={28} height={28} className="login-logo-icon" />
            School Management
          </div>
          <p className="login-sub">Reset Password</p>

          {mode === 'request' ? (
            <>
              <div className="form-group">
                <label htmlFor="fp-identifier">Username or Email</label>
                <input
                  type="text"
                  id="fp-identifier"
                  placeholder="Enter username or email"
                  value={identifier}
                  onChange={(e) => setIdentifier(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && requestOtp()}
                />
              </div>
              <button className="login-btn" disabled={submitting} onClick={requestOtp}>
                {submitting ? 'Sending…' : 'Send Code'}
              </button>
            </>
          ) : (
            <>
              <div className="form-group">
                <label htmlFor="fp-otp">6-digit Code</label>
                <input
                  type="text"
                  id="fp-otp"
                  inputMode="numeric"
                  maxLength={6}
                  placeholder="Enter code from email"
                  autoComplete="one-time-code"
                  value={otp}
                  onChange={(e) => setOtp(e.target.value.replace(/\D/g, ''))}
                />
              </div>
              <div className="form-group">
                <label htmlFor="fp-new">New Password</label>
                <input
                  type="password"
                  id="fp-new"
                  placeholder="At least 6 characters"
                  autoComplete="new-password"
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                />
              </div>
              <div className="form-group">
                <label htmlFor="fp-confirm">Confirm New Password</label>
                <input
                  type="password"
                  id="fp-confirm"
                  placeholder="Re-enter password"
                  autoComplete="new-password"
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && resetPassword()}
                />
              </div>
              <button className="login-btn" disabled={submitting} onClick={resetPassword}>
                {submitting ? 'Resetting…' : 'Reset Password'}
              </button>
              <p style={{ marginTop: 10, textAlign: 'center', fontSize: 13 }}>
                <a href="#" onClick={(e) => { e.preventDefault(); requestOtp(); }}>Resend code</a>
              </p>
            </>
          )}

          {info && <p style={{ marginTop: 10, fontSize: 13, color: '#16a34a' }}>{info}</p>}
          <p className="login-error">{error}</p>
          <p style={{ marginTop: 10, textAlign: 'center', fontSize: 13 }}>
            <a href="#" onClick={(e) => { e.preventDefault(); switchMode('login'); }}>Back to sign in</a>
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="login-page">
      <div className="login-box">
        <div className="login-logo">
          <img src="/icon-192.png" alt="" width={28} height={28} className="login-logo-icon" />
          School Management
        </div>
        <p className="login-sub">Administrator Login</p>

        <div className="form-group">
          <label htmlFor="username">Username</label>
          <input
            type="text"
            id="username"
            placeholder="Enter username"
            autoComplete="username"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
          />
        </div>
        <div className="form-group">
          <label htmlFor="password">Password</label>
          <input
            ref={passwordRef}
            type="password"
            id="password"
            placeholder="Enter password"
            autoComplete="current-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') doLogin();
            }}
          />
        </div>
        <button className="login-btn" id="loginBtn" disabled={submitting} onClick={doLogin}>
          {submitting ? 'Signing in…' : 'Sign In'}
        </button>
        <p className="login-error" id="loginError">
          {error}
        </p>
        {info && <p style={{ marginTop: 10, fontSize: 13, color: '#16a34a' }}>{info}</p>}
        <p style={{ marginTop: 10, textAlign: 'center', fontSize: 13 }}>
          <a
            href="#"
            onClick={(e) => {
              e.preventDefault();
              setIdentifier(username);
              switchMode('request');
            }}
          >
            Forgot password?
          </a>
        </p>
      </div>
    </div>
  );
}
