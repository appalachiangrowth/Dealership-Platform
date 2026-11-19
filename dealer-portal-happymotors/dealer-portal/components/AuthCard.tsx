export function AuthCard({ title, desc, children, footer }: { title: string; desc?: string; children: React.ReactNode; footer?: React.ReactNode }) {
  return (
    <div className="flex min-h-screen items-center justify-center bg-gradient-to-br from-[#062B49] via-[#0b3a63] to-[#0057B8] p-4">
      <div className="w-full max-w-md">
        <div className="mb-6 flex items-center justify-center gap-3 text-white">
          <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-white/15 font-heading text-lg font-extrabold ring-1 ring-white/30">AGS</div>
          <div>
            <div className="font-heading text-lg font-bold leading-tight">Dealer Platform</div>
            <div className="text-xs text-white/70">Appalachian Growth Solutions</div>
          </div>
        </div>
        <div className="rounded-2xl bg-white p-7 shadow-2xl">
          <h1 className="font-heading text-xl font-extrabold text-slate-900">{title}</h1>
          {desc && <p className="mt-1 text-sm text-slate-500">{desc}</p>}
          <div className="mt-6">{children}</div>
        </div>
        {footer && <div className="mt-5 text-center text-sm text-white/80">{footer}</div>}
      </div>
    </div>
  );
}
