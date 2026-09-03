declare global {
  namespace Express {
    interface Request {
      rawBody?: Buffer;
      admin?: {
        id: string;
        email: string;
        name: string;
        role: string;
      };
    }
  }
}

export {};
