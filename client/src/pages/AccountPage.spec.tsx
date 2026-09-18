import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { AuthSessionResponse } from 'shared';
import { api } from '../api/client';
import { useAuth } from '../auth/AuthProvider';
import { renderWithRouter } from '../test/render';
import AccountPage from './AccountPage';

vi.mock('../auth/AuthProvider', () => ({
  useAuth: vi.fn(),
}));

vi.mock('../api/client', () => ({
  api: {
    authLogin: vi.fn(),
    authRegister: vi.fn(),
    authGoogleStart: vi.fn(),
  },
}));

const SESSION: AuthSessionResponse = {
  user: { email: 'nick@example.com', googleLinked: false, hasPassword: true },
  ownerToken: 'owner-token',
};

function mockAuth(overrides: Partial<ReturnType<typeof useAuth>> = {}) {
  const value = {
    user: null,
    googleEnabled: false,
    applySession: vi.fn(),
    logout: vi.fn(),
    ready: true,
    refresh: vi.fn(),
    ...overrides,
  };
  vi.mocked(useAuth).mockReturnValue(value as ReturnType<typeof useAuth>);
  return value;
}

describe('AccountPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockAuth();
  });

  it('shows login and register for a guest and hides Google when disabled', () => {
    renderWithRouter(<AccountPage />, { route: '/account' });

    expect(screen.getByTestId('account-login-email')).toBeInTheDocument();
    expect(screen.getByTestId('account-login-password')).toBeInTheDocument();
    expect(screen.getByTestId('account-login-submit')).toBeInTheDocument();
    expect(screen.getByTestId('account-register-email')).toBeInTheDocument();
    expect(screen.getByTestId('account-register-password')).toBeInTheDocument();
    expect(screen.getByTestId('account-register-submit')).toBeInTheDocument();
    expect(screen.queryByTestId('account-google')).not.toBeInTheDocument();
  });

  it('submits login credentials and applies the session', async () => {
    const user = userEvent.setup();
    const auth = mockAuth();
    vi.mocked(api.authLogin).mockResolvedValue(SESSION);

    renderWithRouter(<AccountPage />, { route: '/account' });
    await user.type(screen.getByTestId('account-login-email'), 'nick@example.com');
    await user.type(screen.getByTestId('account-login-password'), 'password1');
    await user.click(screen.getByTestId('account-login-submit'));

    await waitFor(() => {
      expect(api.authLogin).toHaveBeenCalledWith('nick@example.com', 'password1');
    });
    expect(auth.applySession).toHaveBeenCalledWith(SESSION);
  });

  it('shows a localized error when login credentials are invalid', async () => {
    const user = userEvent.setup();
    vi.mocked(api.authLogin).mockRejectedValue(new Error('Invalid email or password'));

    renderWithRouter(<AccountPage />, { route: '/account' });
    await user.type(screen.getByTestId('account-login-email'), 'nick@example.com');
    await user.type(screen.getByTestId('account-login-password'), 'password1');
    await user.click(screen.getByTestId('account-login-submit'));

    const error = await screen.findByTestId('account-error');
    expect(error.textContent?.trim()).not.toBe('');
    expect(error).toHaveTextContent(/invalid|неверн/i);
  });

  it('shows the signed-in email and signs out', async () => {
    const user = userEvent.setup();
    const auth = mockAuth({
      user: { email: 'nick@example.com', googleLinked: false, hasPassword: true },
    });

    renderWithRouter(<AccountPage />, { route: '/account' });

    expect(screen.getByTestId('account-email')).toHaveTextContent('nick@example.com');
    expect(screen.queryByTestId('account-login-submit')).not.toBeInTheDocument();

    await user.click(screen.getByTestId('account-sign-out'));
    expect(auth.logout).toHaveBeenCalled();
  });

  it('shows Google sign-in when enabled and starts OAuth', async () => {
    const user = userEvent.setup();
    mockAuth({ googleEnabled: true });
    vi.mocked(api.authGoogleStart).mockResolvedValue({ url: 'https://accounts.google.test/start' });
    const assign = vi.fn();
    vi.stubGlobal('location', { ...window.location, assign });

    renderWithRouter(<AccountPage />, { route: '/account' });
    await user.click(screen.getByTestId('account-google'));

    await waitFor(() => {
      expect(api.authGoogleStart).toHaveBeenCalled();
    });
    expect(assign).toHaveBeenCalledWith('https://accounts.google.test/start');

    vi.unstubAllGlobals();
  });
});
