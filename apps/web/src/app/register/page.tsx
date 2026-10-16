'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { useAuth } from '@/lib/auth-context';
import { ApiError } from '@/lib/api';
import Image from 'next/image';
import logo from '../../../public/img/SHS_Job_Pilot_Logo1.png';

const schema = z
  .object({
    email: z.string().email(),
    password: z.string().min(8, 'At least 8 characters'),
    confirm: z.string(),
  })
  .refine((d) => d.password === d.confirm, {
    message: 'Passwords do not match',
    path: ['confirm'],
  });
type FormValues = z.infer<typeof schema>;

export default function RegisterPage() {
  const router = useRouter();
  const { register: doRegister } = useAuth();
  const [error, setError] = useState<string | null>(null);
  const { register, handleSubmit, formState } = useForm<FormValues>({
    resolver: zodResolver(schema),
  });

  async function onSubmit(values: FormValues) {
    setError(null);
    try {
      await doRegister(values.email, values.password);
      router.push('/onboarding');
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Registration failed');
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-50 px-4">
      <div className="w-full max-w-sm">
        <div className="mb-8 flex items-center justify-center gap-2">
          {/* <Briefcase className="h-6 w-6 text-brand-600" /> */}
          <Image src={logo} alt="SHS Job Pilot Logo" width={40} height={40} className="" />
          <span className="text-lg font-semibold">SHS Job Pilot</span>
        </div>
        <form onSubmit={handleSubmit(onSubmit)} className="card space-y-4">
          <h1 className="text-xl font-semibold">Create your account</h1>
          <div>
            <label className="label">Email</label>
            <input type="email" autoComplete="email" {...register('email')} className="input" />
          </div>
          <div>
            <label className="label">Password</label>
            <input
              type="password"
              autoComplete="new-password"
              {...register('password')}
              className="input"
            />
            {formState.errors.password && (
              <p className="mt-1 text-xs text-red-600">{formState.errors.password.message}</p>
            )}
          </div>
          <div>
            <label className="label">Confirm password</label>
            <input
              type="password"
              autoComplete="new-password"
              {...register('confirm')}
              className="input"
            />
            {formState.errors.confirm && (
              <p className="mt-1 text-xs text-red-600">{formState.errors.confirm.message}</p>
            )}
          </div>
          {error && <p className="text-sm text-red-600">{error}</p>}
          <button type="submit" disabled={formState.isSubmitting} className="btn-primary w-full">
            {formState.isSubmitting ? 'Creating account…' : 'Create account'}
          </button>
          <p className="text-center text-sm text-slate-600">
            Already have an account?{' '}
            <Link href="/login" className="text-brand-600 hover:underline">
              Sign in
            </Link>
          </p>
        </form>
      </div>
    </div>
  );
}
