import Link from 'next/link';
import { Briefcase, Bot, FileCheck, Shield } from 'lucide-react';
import Image from 'next/image';
import logo from '../../public/img/SHS_Job_Pilot_Logo1.png';


export default function HomePage() {
  return (
    <main className="min-h-screen bg-gradient-to-b from-white to-slate-50">
      <header className="mx-auto flex max-w-6xl items-center justify-between p-6">
        <div className="flex items-center gap-2">
          {/* <Briefcase className="h-6 w-6 text-brand-600" /> */}
          <Image src={logo} alt="SHS Job Pilot Logo" width={40} height={40} className="" />
          <span className="text-lg font-semibold">SHS Job Pilot</span>
        </div>
        <nav className="flex items-center gap-4 text-sm">
          <Link href="/login" className="text-slate-600 hover:text-slate-900">Sign in</Link>
          <Link href="/register" className="btn-primary">Get started</Link>
        </nav>
      </header>

      <section className="mx-auto max-w-4xl px-6 py-20 text-center">
        <h1 className="text-5xl font-bold tracking-tight text-slate-900">
          Find, match, and apply to jobs — automatically.
        </h1>
        <p className="mt-6 text-lg text-slate-600">
          SHS Job Pilot aggregates jobs from across Nigeria and beyond, scores each
          against your career profile, and applies to the ones that fit — with your
          rules, your consent, and full transparency.
        </p>
        <div className="mt-8 flex justify-center gap-3">
          <Link href="/register" className="btn-primary px-6 py-3 text-base">Create account</Link>
          <Link href="/login" className="btn-secondary px-6 py-3 text-base">Sign in</Link>
        </div>
      </section>

      <section className="mx-auto grid max-w-6xl gap-6 px-6 pb-24 md:grid-cols-4">
        {[
          { icon: Briefcase, title: 'Aggregated discovery', body: 'Jobs from Adzuna, plus manual tracking for LinkedIn, Indeed, and Jobberman.' },
          { icon: Bot, title: 'AI matching', body: 'Gemini scores each job against your profile — never fabricating qualifications.' },
          { icon: FileCheck, title: 'Applications on autopilot', body: 'Cover letters and application materials prepared from your real experience.' },
          { icon: Shield, title: 'You stay in control', body: 'Deterministic rules, approval queues, and a big pause button.' },
        ].map(({ icon: Icon, title, body }) => (
          <div key={title} className="card">
            <Icon className="h-6 w-6 text-brand-600" />
            <h3 className="mt-3 font-semibold">{title}</h3>
            <p className="mt-2 text-sm text-slate-600">{body}</p>
          </div>
        ))}
      </section>
    </main>
  );
}
