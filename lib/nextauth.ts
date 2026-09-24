/**
 * NextAuth — the sign-in system Stiko has run since launch, and the rollback
 * path while WorkOS is introduced behind AUTH_PROVIDER.
 *
 * Nothing outside the auth layer imports this directly: route handlers call
 * auth() from lib/auth.ts, which chooses the provider.
 */
import NextAuth from 'next-auth';
import Credentials from 'next-auth/providers/credentials';
import PostgresAdapter from '@auth/pg-adapter';
import { Pool } from '@neondatabase/serverless';
import { sql } from '@/lib/db';

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

export const { handlers, signIn, signOut, auth } = NextAuth({
  adapter: PostgresAdapter(pool),
  session: { strategy: 'jwt' },
  pages: {
    signIn: '/login',
  },
  providers: [
    Credentials({
      credentials: {
        email: { label: 'Email', type: 'email' },
        password: { label: 'Password', type: 'password' },
      },
      async authorize(credentials) {
        const { email, password } = credentials as { email: string; password: string };
        if (!email || !password) return null;

        // Case-insensitive, like sign-up and forgot-password. The exact match
        // here meant a reset for Dana@Co.com "succeeded" while signing in as
        // dana@co.com still failed. Safe since migration 010: the
        // lower(email) unique index guarantees this matches at most one row.
        const rows = await sql`
          SELECT id, name, email, password_hash FROM users
          WHERE lower(email) = lower(${email.trim()})
        `;
        const user = rows[0];
        if (!user) return null;

        const { comparePassword } = await import('@/lib/password');
        const valid = await comparePassword(password, user.password_hash as string);
        if (!valid) return null;

        return { id: user.id as string, name: user.name as string, email: user.email as string };
      },
    }),
  ],
  callbacks: {
    async jwt({ token, user }) {
      if (user) token.id = user.id;
      return token;
    },
    async session({ session, token }) {
      if (token.id) session.user.id = token.id as string;
      return session;
    },
  },
});
