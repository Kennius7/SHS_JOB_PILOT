'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { CheckCircle2, Loader2, XCircle } from 'lucide-react';
import { api, ApiError } from '@/lib/api';

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
    <div className="flex min-h-screen items-center justify-center bg-slate-50 px-4">
      <div className="card w-full max-w-sm space-y-4 text-center">
        <h1 className="text-xl font-semibold">Email verification</h1>
        {status === 'loading' && (
          <>
            <Loader2 className="mx-auto h-8 w-8 animate-spin text-brand-600" />
            <p className="text-sm text-slate-600">{message}</p>
          </>
        )}
        {status === 'success' && (
          <>
            <CheckCircle2 className="mx-auto h-8 w-8 text-green-600" />
            <p className="text-sm text-slate-600">{message}</p>
            <Link href="/login" className="btn-primary block w-full">
              Continue to sign in
            </Link>
          </>
        )}
        {status === 'error' && (
          <>
            <XCircle className="mx-auto h-8 w-8 text-red-600" />
            <p className="text-sm text-slate-600">{message}</p>
            <p className="text-xs text-slate-500">
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
