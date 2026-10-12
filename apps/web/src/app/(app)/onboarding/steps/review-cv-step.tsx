'use client';
import { useEffect, useState } from 'react';
import { useQuery, useMutation } from '@tanstack/react-query';
import { Check, X, Sparkles, User, Briefcase, GraduationCap } from 'lucide-react';
import { api } from '@/lib/api';
import { useOnboarding } from '@/lib/onboarding-context';

type Section = 'contact' | 'skills' | 'experience' | 'education' | 'summary';

export function ReviewCvStep() {
  const { next, back } = useOnboarding();
  const [accepted, setAccepted] = useState<Set<Section>>(new Set(['contact', 'skills', 'experience', 'education', 'summary']));
  const [edited, setEdited] = useState<any>(null);

  const { data: docs } = useQuery({ queryKey: ['documents'], queryFn: () => api.get<any[]>('/v1/documents') });
  const cvDoc = docs?.find((d) => d.parsedData && d.kind === 'CV');

  useEffect(() => { if (cvDoc?.parsedData && !edited) setEdited(cvDoc.parsedData); }, [cvDoc, edited]);

  const apply = useMutation({
    mutationFn: () => api.post('/v1/profile/apply-parsed', {
      documentId: cvDoc.id,
      acceptedSections: Array.from(accepted),
      profile: edited?.fullName || edited?.phone ? { fullName: edited.fullName, phone: edited.phone } : undefined,
      skills: edited?.skills?.map((name: string) => ({ name })),
      experience: edited?.experience,
      education: edited?.education,
    }),
    onSuccess: () => next(),
  });

  if (!cvDoc || !edited) {
    return (
      <div className="card text-center text-sm text-slate-500">
        No parsed CV found. <button onClick={next} className="text-brand-600 underline">Continue manually</button>.
      </div>
    );
  }

  function toggle(s: Section) {
    setAccepted((p) => { const n = new Set(p); n.has(s) ? n.delete(s) : n.add(s); return n; });
  }

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-2xl font-semibold">Review what we found</h1>
        <p className="mt-2 text-sm text-slate-600">This is AI-extracted from your CV. Uncheck anything wrong. Nothing saves until you confirm.</p>
      </header>

      <SectionBox icon={<User className="h-4 w-4" />} title="Contact" accepted={accepted.has('contact')} onToggle={() => toggle('contact')}>
        <p className="text-sm">{edited.fullName ?? 'Not set'} · {edited.phone ?? 'No phone'}</p>
      </SectionBox>

      <SectionBox icon={<Sparkles className="h-4 w-4" />} title={`Skills (${edited.skills?.length ?? 0})`} accepted={accepted.has('skills')} onToggle={() => toggle('skills')}>
        <div className="flex flex-wrap gap-1.5">
          {(edited.skills ?? []).map((s: string, i: number) => (
            <span key={i} className="inline-flex items-center gap-1 rounded-full bg-slate-100 px-2.5 py-1 text-xs">
              {s}
              <button onClick={() => setEdited({ ...edited, skills: edited.skills.filter((_: any, j: number) => j !== i) })}>
                <X className="h-3 w-3 text-slate-400" />
              </button>
            </span>
          ))}
        </div>
      </SectionBox>

      <SectionBox icon={<Briefcase className="h-4 w-4" />} title={`Experience (${edited.experience?.length ?? 0})`} accepted={accepted.has('experience')} onToggle={() => toggle('experience')}>
        {(edited.experience ?? []).map((e: any, i: number) => (
          <div key={i} className="rounded border border-slate-200 p-3 text-sm">
            <div className="font-medium">{e.title}</div>
            <div className="text-slate-600">{e.employer}</div>
          </div>
        ))}
      </SectionBox>

      <SectionBox icon={<GraduationCap className="h-4 w-4" />} title={`Education (${edited.education?.length ?? 0})`} accepted={accepted.has('education')} onToggle={() => toggle('education')}>
        {(edited.education ?? []).map((e: any, i: number) => (
          <div key={i} className="text-sm">
            <div className="font-medium">{e.institution}</div>
            {e.degree && <div className="text-slate-600">{e.degree}</div>}
          </div>
        ))}
      </SectionBox>

      <div className="flex justify-between pt-4">
        <button onClick={back} className="btn-secondary">Back</button>
        <button onClick={() => apply.mutate()} disabled={apply.isPending || accepted.size === 0} className="btn-primary">
          {apply.isPending ? 'Saving…' : `Accept ${accepted.size} section${accepted.size === 1 ? '' : 's'}`}
        </button>
      </div>
    </div>
  );
}

function SectionBox({ icon, title, accepted, onToggle, children }: any) {
  return (
    <div className={`card transition-opacity ${accepted ? '' : 'opacity-50'}`}>
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">{icon}<h2 className="font-medium">{title}</h2></div>
        <button onClick={onToggle} className={`flex items-center gap-1 rounded-full px-2 py-0.5 text-xs ${accepted ? 'bg-green-100 text-green-700' : 'bg-slate-100 text-slate-500'}`}>
          {accepted ? <><Check className="h-3 w-3" /> Accepted</> : 'Skipped'}
        </button>
      </div>
      <div className="mt-3">{children}</div>
    </div>
  );
}
