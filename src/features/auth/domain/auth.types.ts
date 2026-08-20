export type AuthenticatedAdmin = {
  id: string;
  email: string;
  name: string;
  role: string;
};

export type AdminLoginResult = {
  accessToken: string;
  admin: AuthenticatedAdmin;
};
