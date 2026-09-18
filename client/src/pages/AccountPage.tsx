import { useState } from 'react';
import type { FormEvent } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { api } from '../api/client';
import { useAuth } from '../auth/AuthProvider';
import './AccountPage.css';

const SERVER_ERROR_KEYS: Record<string, string> = {
  'An account with this email already exists': 'account.errors.emailTaken',
  'This browser already has an account. Log in instead.': 'account.errors.alreadyOnThisBrowser',
  'This email uses Google sign-in': 'account.errors.googleOnly',
  'Invalid email or password': 'account.errors.invalidCredentials',
  'Password must be 8–128 characters': 'account.errors.passwordLength',
  'Invalid email': 'account.errors.invalidEmail',
  'Email and password required': 'account.errors.required',
  'Google sign-in is not configured': 'account.errors.googleDisabled',
  'Google sign-in expired. Try again.': 'account.errors.googleExpired',
  'Google sign-in failed': 'account.errors.googleFailed',
};

function localizeError(raw: string, t: (key: string) => string): string {
  const key = SERVER_ERROR_KEYS[raw];
  return key ? t(key) : raw;
}

export default function AccountPage() {
  const { t } = useTranslation();
  const { user, googleEnabled, applySession, logout } = useAuth();
  const [params] = useSearchParams();
  const [loginEmail, setLoginEmail] = useState('');
  const [loginPassword, setLoginPassword] = useState('');
  const [registerEmail, setRegisterEmail] = useState('');
  const [registerPassword, setRegisterPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const shownError = error ?? (params.get('error') === 'google' ? t('account.errors.googleFailed') : null);

  const onLogin = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      applySession(await api.authLogin(loginEmail, loginPassword));
    } catch (err) {
      setError(localizeError(err instanceof Error ? err.message : t('account.errors.failed'), t));
    } finally {
      setBusy(false);
    }
  };

  const onRegister = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      applySession(await api.authRegister(registerEmail, registerPassword));
    } catch (err) {
      setError(localizeError(err instanceof Error ? err.message : t('account.errors.failed'), t));
    } finally {
      setBusy(false);
    }
  };

  const onGoogle = async () => {
    setBusy(true);
    setError(null);
    try {
      const { url } = await api.authGoogleStart();
      window.location.assign(url);
    } catch (err) {
      setError(localizeError(err instanceof Error ? err.message : t('account.errors.googleFailed'), t));
      setBusy(false);
    }
  };

  if (user) {
    return (
      <div className="page account-page">
        <div className="section-head">
          <h2>{t('account.title')}</h2>
          <div className="rule" />
        </div>
        {params.get('ok') === '1' ? <p className="account-ok">{t('account.googleOk')}</p> : null}
        <div className="panel account-signed-in">
          <p className="account-email" data-testid="account-email">
            {user.email}
          </p>
          <p className="account-note">{t('account.signedInNote')}</p>
          <div className="account-signed-actions">
            <Link to="/history" className="btn btn-primary" viewTransition>
              {t('account.toHistory')}
            </Link>
            <button
              type="button"
              className="btn btn-ghost"
              data-testid="account-sign-out"
              onClick={() => void logout()}
            >
              {t('app.nav.signOut')}
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="page account-page">
      <div className="section-head">
        <h2>{t('account.title')}</h2>
        <div className="rule" />
      </div>
      <p className="account-lead">{t('account.lead')}</p>
      {shownError ? (
        <p className="error-text" data-testid="account-error">
          {shownError}
        </p>
      ) : null}

      {googleEnabled ? (
        <button
          type="button"
          className="btn btn-secondary account-google"
          data-testid="account-google"
          disabled={busy}
          onClick={() => void onGoogle()}
        >
          {t('account.google')}
        </button>
      ) : null}

      <div className="account-grid">
        <form className="panel account-form" onSubmit={(e) => void onLogin(e)}>
          <h3>{t('account.loginTitle')}</h3>
          <label className="account-field">
            <span>{t('account.email')}</span>
            <input
              data-testid="account-login-email"
              type="email"
              autoComplete="username"
              value={loginEmail}
              onChange={(e) => setLoginEmail(e.target.value)}
              required
            />
          </label>
          <label className="account-field">
            <span>{t('account.password')}</span>
            <input
              data-testid="account-login-password"
              type="password"
              autoComplete="current-password"
              value={loginPassword}
              onChange={(e) => setLoginPassword(e.target.value)}
              minLength={8}
              maxLength={128}
              required
            />
          </label>
          <button
            type="submit"
            className="btn btn-primary"
            data-testid="account-login-submit"
            disabled={busy}
          >
            {t('account.loginSubmit')}
          </button>
        </form>

        <form className="panel account-form" onSubmit={(e) => void onRegister(e)}>
          <h3>{t('account.registerTitle')}</h3>
          <p className="account-form-note">{t('account.registerNote')}</p>
          <label className="account-field">
            <span>{t('account.email')}</span>
            <input
              data-testid="account-register-email"
              type="email"
              autoComplete="email"
              value={registerEmail}
              onChange={(e) => setRegisterEmail(e.target.value)}
              required
            />
          </label>
          <label className="account-field">
            <span>{t('account.password')}</span>
            <input
              data-testid="account-register-password"
              type="password"
              autoComplete="new-password"
              value={registerPassword}
              onChange={(e) => setRegisterPassword(e.target.value)}
              minLength={8}
              maxLength={128}
              required
            />
          </label>
          <button
            type="submit"
            className="btn btn-secondary"
            data-testid="account-register-submit"
            disabled={busy}
          >
            {t('account.registerSubmit')}
          </button>
        </form>
      </div>
    </div>
  );
}
