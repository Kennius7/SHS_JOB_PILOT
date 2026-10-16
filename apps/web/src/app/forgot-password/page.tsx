'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { MailCheck } from 'lucide-react';
import { api, ApiError } from '@/lib/api';
import { ThemeToggle } from '@/components/theme-toggle';

const schema = z.object({ email: z.string().email() });
type FormValues = z.infer<typeof schema>;

export default function ForgotPasswordPage() {
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { register, handleSubmit, formState } = useForm<FormValues>({
    resolver: zodResolver(schema),
  });

  async function onSubmit(values: FormValues) {
    setError(null);
    try {
      await api.post('/v1/auth/forgot-password', { email: values.email });
      setSent(true);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Request failed');
    }
  }

  return (
    <div className="relative flex min-h-screen items-center justify-center bg-background px-4 py-10">
      <div className="absolute right-4 top-4">
        <ThemeToggle />
      </div>
      <div className="w-full max-w-sm">
        <form onSubmit={handleSubmit(onSubmit)} className="card space-y-4">
          <h1 className="text-xl font-semibold">Reset your password</h1>
          {sent ? (
            <div className="space-y-3 text-center">
              <MailCheck className="mx-auto h-8 w-8 text-green-600 dark:text-green-400" />
              <p className="text-sm text-muted-foreground">
                If an account exists for that email, we&apos;ve sent a reset link. Check your inbox.
              </p>
              <Link href="/login" className="btn-primary block w-full">
                Back to sign in
              </Link>
            </div>
          ) : (
            <>
              <p className="text-sm text-muted-foreground">
                Enter your email and we&apos;ll send you a link to reset your password.
              </p>
              <div>
                <label className="label" htmlFor="email">
                  Email
                </label>
                <input
                  id="email"
                  type="email"
                  autoComplete="email"
                  {...register('email')}
                  className="input"
                />
              </div>
              {error && <p className="text-sm text-red-600 dark:text-red-400">{error}</p>}
              <button
                type="submit"
                disabled={formState.isSubmitting}
                className="btn-primary w-full"
              >
                {formState.isSubmitting ? 'Sending…' : 'Send reset link'}
              </button>
              <p className="text-center text-sm text-muted-foreground">
                <Link href="/login" className="text-brand-600 hover:underline">
                  Back to sign in
                </Link>
              </p>
            </>
          )}
        </form>
      </div>
    </div>
  );
}
