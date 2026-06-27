import { customAlphabet } from 'nanoid';

const nanoid = customAlphabet(
  'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789',
  7,
);

const RESERVED_SLUGS = new Set([
  'api',
  'admin',
  'health',
  'dashboard',
  'login',
  'signup',
  'register',
  'logout',
  'static',
  'assets',
  'favicon',
  'v1',
  'auth',
  'links',
  'redirect',
  'user',
  'users',
]);

export const generateSlug = () => nanoid();

export const isReserved = (slug: string) =>
  RESERVED_SLUGS.has(slug.toLowerCase());
