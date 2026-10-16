'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { CheckCircle2, Loader2, XCircle } from 'lucide-react';
import { api, ApiError } from '@/lib/api';
import { ThemeToggle } from '@/components/theme-toggle';

type Status = 'loading' | 'success' | 'error';

export default function VerifyEmailPage() {
  const [status, setStatus] = useState<Status>('loading');
  const [message, setMessage] = useState('Verifying your email…');

  useEffect(() => {
    const token = new URLSearchParams(window.location.search).get('token');
    if (!token) {
      setStatus('error');
      setMessage('Missing verification token.');
      return;
    }
    let active = true;
    api
      .post('/v1/auth/verify-email', { token })
      .then(() => {
        if (!active) return;
        setStatus('success');
        setMessage('Your email has been verified.');
      })
      .catch((e) => {
        if (!active) return;
        setStatus('error');
        setMessage(e instanceof ApiError ? e.message : 'Verification failed.');
      });
    return () => {
      active = false;
    };
  }, []);

  return (
    <div className="relative flex min-h-screen items-center justify-center bg-background px-4 py-10">
      <div className="absolute right-4 top-4">
        <ThemeToggle />
      </div>
      <div className="card w-full max-w-sm space-y-4 text-center">
        <h1 className="text-xl font-semibold">Email verification</h1>
        {status === 'loading' && (
          <>
            <Loader2 className="mx-auto h-8 w-8 animate-spin text-brand-600" />
            <p className="text-sm text-muted-foreground">{message}</p>
          </>
        )}
        {status === 'success' && (
          <>
            <CheckCircle2 className="mx-auto h-8 w-8 text-green-600 dark:text-green-400" />
            <p className="text-sm text-muted-foreground">{message}</p>
            <Link href="/login" className="btn-primary block w-full">
              Continue to sign in
            </Link>
          </>
        )}
        {status === 'error' && (
          <>
            <XCircle className="mx-auto h-8 w-8 text-red-600 dark:text-red-400" />
            <p className="text-sm text-muted-foreground">{message}</p>
            <p className="text-xs text-muted-foreground">
              You can request a new link from your account settings after signing in.
            </p>
            <Link href="/login" className="btn-secondary block w-full">
              Back to sign in
            </Link>
          </>
        )}
      </div>
    </div>
  );
}
