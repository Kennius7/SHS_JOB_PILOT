import Link from 'next/link';
import { Bot, Briefcase, FileCheck, Shield } from 'lucide-react';
import Image from 'next/image';
import logo from '../../public/img/SHS_Job_Pilot_Logo1.png';
import { ThemeToggle } from '@/components/theme-toggle';

export default function HomePage() {
  return (
    <main className="min-h-screen bg-gradient-to-b from-card to-background">
      <header className="mx-auto flex max-w-6xl items-center justify-between gap-3 px-4 py-4 sm:px-6 sm:py-6">
        <div className="flex min-w-0 items-center gap-2">
          <Image src={logo} alt="SHS Job Pilot Logo" width={40} height={40} className="h-10 w-10" />
          <span className="truncate text-lg font-semibold">SHS Job Pilot</span>
        </div>
        <nav className="flex items-center gap-2 text-sm sm:gap-4">
          <Link
            href="/login"
            className="hidden text-muted-foreground hover:text-foreground sm:inline"
          >
            Sign in
          </Link>
          <Link href="/register" className="btn-primary">
            Get started
          </Link>
          <ThemeToggle />
        </nav>
      </header>

      <section className="mx-auto max-w-4xl px-4 py-16 text-center sm:px-6 sm:py-20">
        <h1 className="text-4xl font-bold tracking-tight text-foreground sm:text-5xl">
          Find, match, and apply to jobs — automatically.
        </h1>
        <p className="mt-6 text-base text-muted-foreground sm:text-lg">
          SHS Job Pilot aggregates jobs from across Nigeria and beyond, scores each against your
          career profile, and applies to the ones that fit — with your rules, your consent, and full
          transparency.
        </p>
        <div className="mt-8 flex flex-col justify-center gap-3 sm:flex-row">
          <Link href="/register" className="btn-primary px-6 py-3 text-base">
            Create account
          </Link>
          <Link href="/login" className="btn-secondary px-6 py-3 text-base">
            Sign in
          </Link>
        </div>
      </section>

      <section className="mx-auto grid max-w-6xl gap-6 px-4 pb-24 sm:grid-cols-2 sm:px-6 lg:grid-cols-4">
        {[
          {
            icon: Briefcase,
            title: 'Aggregated discovery',
            body: 'Jobs from Adzuna, plus manual tracking for LinkedIn, Indeed, and Jobberman.',
          },
          {
            icon: Bot,
            title: 'AI matching',
            body: 'Gemini scores each job against your profile — never fabricating qualifications.',
          },
          {
            icon: FileCheck,
            title: 'Applications on autopilot',
            body: 'Cover letters and application materials prepared from your real experience.',
          },
          {
            icon: Shield,
            title: 'You stay in control',
            body: 'Deterministic rules, approval queues, and a big pause button.',
          },
        ].map(({ icon: Icon, title, body }) => (
          <div key={title} className="card">
            <Icon className="h-6 w-6 text-brand-600" />
            <h3 className="mt-3 font-semibold">{title}</h3>
            <p className="mt-2 text-sm text-muted-foreground">{body}</p>
          </div>
        ))}
      </section>
    </main>
  );
}
