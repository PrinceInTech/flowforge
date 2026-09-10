export interface SignUpInput {
  email: string;
  password: string;
  name?: string;
}

export interface SignInInput {
  email: string;
  password: string;
}

export interface AuthTokens {
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
}