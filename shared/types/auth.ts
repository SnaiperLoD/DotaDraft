export interface AuthUserView {
  email: string;
  googleLinked: boolean;
  hasPassword: boolean;
}

export interface AuthMeResponse {
  user: AuthUserView | null;
  googleEnabled: boolean;
  ownerToken: string | null;
}

export interface AuthSessionResponse {
  user: AuthUserView;
  ownerToken: string;
}

export interface AuthGoogleStartResponse {
  url: string;
}
