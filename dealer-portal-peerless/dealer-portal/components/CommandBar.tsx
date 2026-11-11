'use client';

/**
 * "Just tell it" — the bar at the top of every page of the portal.
 * Type or speak: "Mark the silver Corolla as sold for $16,500", "Lower the price by $300 on cars listed over 60 days",
 * "Which cars have fewer than 5 photos?", or simply search ("2019 Camry", a VIN, a stock number).
 * A confirmation card shows every change before anything is saved; Undo is offered afterwards.
 */
import Link from 'next/link';
import { useCallback, useEffect, useRef, useState } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { Check, Loader2, Mic, Search, Sparkles, Square, X } from 'lucide-react';
import { aiApi, extractAudio } from '@/lib/ai';
import { useToast } from './toast';
import { cx } from './ui';

type Change = { id: string; car: string; stock: string; what: string; before: string; after: string };
type CarLite = { id: string; name: string; stock: string; ext: string; price: number | null; status: string; photos: number };
type Plan = {
  intent: 'action' | 'question' | 'search' | 'navigate' | 'unclear';
  reply: string;
  search: string;
  page: string;
  car_ids: string[];
  cars: CarLite[];
  actions: unknown[];
  changes: Change[];
  errors: string[];
  noAi?: boolean;
};

const EXAMPLES = [
  'Mark the silver Corolla as sold for $16,500',
  'Lower the price by $300 on cars listed over 60 days',
  'Which cars have fewer than 5 photos?',
  'Post the Buick to Facebook',
  'Feature all SUVs on the home page',
];

const PAGE_URL: Record<string, string> = {
  inventory: '/dealer/inventory',
  add_vehicle: '/dealer/inventory/new?manual=1',
  ai_add: '/dealer/inventory/ai',
  facebook: '/dealer/facebook',
  leads: '/dealer/leads',
  cargurus: '/dealer/cargurus',
  business: '/dealer/business',
  design: '/dealer/design',
  content: '/dealer/content',
  blog: '/dealer/blog',
  team: '/dealer/team',
  overview: '/dealer',
};

/** A plain search (a VIN, a stock number, "2019 Camry") doesn't need the AI. */
const ACTION_WORDS =
  /\b(sold|sell|price|prices|lower|raise|increase|reduce|drop|cut|mark|feature|featured|unfeature|draft|drafts|publish|post|facebook|marketplace|which|what|how|many|much|show|list|delete|remove|hide|change|set|make|add|open|go|older|over|under|days|photos?|average|total|cheapest|most|least|newest|oldest)\b|\?/i;
const looksLikeSearch = (t: string) => !ACTION_WORDS.test(t) && t.split(/\s+/).length <= 4;

const money = (n: number | null) => (n == null ? '' : `$${Math.round(n).toLocaleString('en-US')}`);

export function CommandBar({ enabled = true }: { enabled?: boolean }) {
  const router = useRouter();
  const pathname = usePathname();
  const toast = useToast();
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [focus, setFocus] = useState(false);
  const [plan, setPlan] = useState<Plan | null>(null);
  const [planText, setPlanText] = useState('');
  const [error, setError] = useState('');
  const [applying, setApplying] = useState(false);
  const [undo, setUndo] = useState<{ msg: string } | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const boxRef = useRef<HTMLDivElement>(null);

  // close the card when the page changes
  useEffect(() => {
    setPlan(null);
    setError('');
  }, [pathname]);

  // Ctrl/⌘ + K focuses the bar from anywhere
  useEffect(() => {
    const k = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        inputRef.current?.focus();
      }
      if (e.key === 'Escape') {
        setPlan(null);
        setError('');
      }
    };
    window.addEventListener('keydown', k);
    return () => window.removeEventListener('keydown', k);
  }, []);

  // click outside closes the examples
  useEffect(() => {
    const h = (e: MouseEvent) => {
      if (boxRef.current && !boxRef.current.contains(e.target as Node)) setFocus(false);
    };
    document.addEventListener('mousedown', h);
    return () => document.removeEventListener('mousedown', h);
  }, []);

  const searchInventory = useCallback(
    (term: string) => {
      setPlan(null);
      setFocus(false);
      router.push(`/dealer/inventory${term ? `?q=${encodeURIComponent(term)}` : ''}`);
      // the Inventory page may already be open: tell it about the new search
      setTimeout(() => window.dispatchEvent(new Event('dealer-search')), 50);
    },
    [router],
  );

  const run = async (raw?: string) => {
    const t = (raw ?? text).trim();
    if (!t) {
      inputRef.current?.focus();
      return;
    }
    if (raw !== undefined) setText(raw);
    setError('');
    setPlan(null);
    setFocus(false);
    if (!enabled || looksLikeSearch(t)) {
      searchInventory(t);
      return;
    }
    setBusy(true);
    try {
      const r = await aiApi<Plan>('command', { text: t });
      if (r.intent === 'search') {
        searchInventory(r.search || t);
        return;
      }
      if (r.intent === 'navigate' && r.page && PAGE_URL[r.page]) {
        const id = r.car_ids[0];
        const url = r.page === 'facebook' && id ? `${PAGE_URL.facebook}?vehicle=${encodeURIComponent(id)}` : PAGE_URL[r.page];
        toast.ok(r.reply || 'Opening…');
        setText('');
        router.push(url);
        return;
      }
      setPlan(r);
      setPlanText(t);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const confirm = async () => {
    if (!plan) return;
    setApplying(true);
    try {
      const a = await aiApi<{ changes: Change[]; errors: string[] }>('command/apply', { actions: plan.actions });
      setPlan(null);
      setText('');
      if (a.changes.length) {
        const msg = `Done: ${a.changes.length} change${a.changes.length > 1 ? 's' : ''} saved.`;
        setUndo({ msg });
        setTimeout(() => setUndo((u) => (u?.msg === msg ? null : u)), 15000);
      }
      if (a.errors.length) toast.error(a.errors.join(' '));
      window.dispatchEvent(new Event('inventory-changed'));
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setApplying(false);
    }
  };

  const doUndo = async () => {
    try {
      const r = await aiApi<{ undone: number; errors: string[] }>('command/undo', {});
      setUndo(null);
      toast.ok(`Undone. ${r.undone} vehicle${r.undone === 1 ? ' is' : 's are'} back as they were.`);
      if (r.errors.length) toast.error(r.errors.join(' '));
      window.dispatchEvent(new Event('inventory-changed'));
    } catch (e) {
      toast.error((e as Error).message);
    }
  };

  return (
    <div ref={boxRef} className="relative min-w-0 max-w-[720px] flex-[1_1_320px]">
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void run();
        }}
        autoComplete="off"
        className="flex min-h-[44px] items-center gap-2 rounded-[10px] border border-[#E5E9F0] bg-[#F4F6FA] pl-3 pr-1.5 text-[#526077] focus-within:border-[#8B5CF6] focus-within:bg-white focus-within:shadow-[0_0_0_3px_rgba(139,92,246,0.15)]"
      >
        {enabled ? <Sparkles className="h-[18px] w-[18px] shrink-0 text-[#7C3AED]" /> : <Search className="h-[18px] w-[18px] shrink-0" />}
        <label htmlFor="dealer-search" className="sr-only">
          Tell the portal what to do, or search your vehicles
        </label>
        <input
          id="dealer-search"
          ref={inputRef}
          value={text}
          onChange={(e) => setText(e.target.value)}
          onFocus={() => setFocus(true)}
          placeholder={enabled ? 'Just tell it… e.g. “Mark the silver Corolla as sold for $16,500” — or search' : 'Search vehicles by make, model, VIN or stock number…'}
          className="min-w-0 flex-1 border-0 bg-transparent text-sm text-[#0F172A] outline-none placeholder:text-[#64748B]"
        />
        {enabled && <VoiceButton onText={(t) => setText((x) => `${x.trim() ? `${x.trim()} ` : ''}${t}`.trim())} onError={(m) => toast.error(m)} onDone={() => inputRef.current?.focus()} />}
        <span className="hidden rounded-[5px] border border-[#CBD5E1] px-1.5 py-0.5 text-[11px] font-semibold text-[#526077] xl:inline">Ctrl K</span>
        <button
          type="submit"
          disabled={busy}
          className="inline-flex h-8 min-w-[52px] items-center justify-center rounded-lg bg-[#7C3AED] px-3 text-[13px] font-semibold text-white hover:bg-[#6D28D9] disabled:opacity-70"
        >
          {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Go'}
        </button>
      </form>

      {/* examples */}
      {enabled && focus && !text && !plan && !busy && (
        <div className="absolute left-0 right-0 top-[calc(100%+6px)] z-50 rounded-xl border border-[#E5E9F0] bg-white p-3 shadow-[0_12px_32px_rgba(15,23,42,0.14)]">
          <div className="mb-2 text-xs font-semibold uppercase tracking-[0.06em] text-[#64748B]">Try saying</div>
          <div className="flex flex-wrap gap-2">
            {EXAMPLES.map((x) => (
              <button
                key={x}
                type="button"
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => void run(x)}
                className="rounded-full border border-[#E9E3FF] bg-[#F7F5FF] px-3 py-1.5 text-left text-[12.5px] font-medium text-[#5B3FD6] hover:bg-[#EFEAFF]"
              >
                {x}
              </button>
            ))}
          </div>
          <div className="mt-2.5 text-xs text-[#64748B]">Or type a make, model, VIN or stock number to search. Nothing changes until you confirm.</div>
        </div>
      )}

      {busy && (
        <div className="absolute left-0 right-0 top-[calc(100%+6px)] z-50 flex items-center gap-2 rounded-xl border border-[#E9E3FF] bg-[#F7F5FF] px-4 py-3 text-sm font-medium text-[#5B3FD6] shadow-lg">
          <Loader2 className="h-4 w-4 animate-spin" /> Working out what to do…
        </div>
      )}

      {error && (
        <div className="absolute left-0 right-0 top-[calc(100%+6px)] z-50 flex items-start gap-2 rounded-xl border border-[#FECACA] bg-[#FEF2F2] px-4 py-3 text-sm text-[#7F1D1D] shadow-lg">
          <span className="flex-1">{error}</span>
          <button type="button" onClick={() => setError('')} aria-label="Close" className="text-[#B91C1C]">
            <X className="h-4 w-4" />
          </button>
        </div>
      )}

      {plan && (
        <div className="absolute left-0 top-[calc(100%+6px)] z-50 w-[min(760px,calc(100vw-2rem))] rounded-xl border border-[#E5E9F0] bg-white shadow-[0_16px_40px_rgba(15,23,42,0.18)]">
          <div className="flex max-h-[70vh] flex-col gap-3 overflow-y-auto p-4">
            <div className="flex items-start gap-2.5">
              <Sparkles className="mt-0.5 h-[18px] w-[18px] shrink-0 text-[#7C3AED]" />
              <div className="flex-1 text-sm font-semibold text-[#0F172A]">{plan.reply}</div>
              <button type="button" onClick={() => setPlan(null)} aria-label="Close" className="text-[#64748B] hover:text-[#0F172A]">
                <X className="h-4 w-4" />
              </button>
            </div>
            {plan.errors.length > 0 && (
              <div className="rounded-[10px] border border-[#FDE68A] bg-[#FFFBEB] px-3 py-2 text-[13px] text-[#78350F]">
                {plan.errors.map((e, i) => (
                  <div key={i}>⚠ {e}</div>
                ))}
              </div>
            )}

            {plan.intent === 'action' && plan.changes.length > 0 && (
              <>
                <div className="overflow-x-auto rounded-[10px] border border-[#E5E9F0]">
                  <table className="w-full text-[13px]">
                    <thead className="bg-[#F8FAFC] text-left text-[11.5px] uppercase tracking-[0.04em] text-[#526077]">
                      <tr>
                        <th className="px-3 py-2">Car</th>
                        <th className="px-3 py-2">Change</th>
                        <th className="px-3 py-2">Now</th>
                        <th className="px-3 py-2">After</th>
                      </tr>
                    </thead>
                    <tbody>
                      {plan.changes.map((c) => (
                        <tr key={c.id} className="border-t border-[#EEF1F6]">
                          <td className="px-3 py-2">
                            <b className="text-[#0F172A]">{c.car}</b>
                            {c.stock && <div className="text-xs text-[#64748B]">{c.stock}</div>}
                          </td>
                          <td className="px-3 py-2 text-[#334155]">{c.what}</td>
                          <td className="px-3 py-2 text-[#64748B]">{c.before}</td>
                          <td className="px-3 py-2 font-bold text-[#15803D]">{c.after}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <div className="flex flex-wrap items-center gap-2.5">
                  <button
                    type="button"
                    disabled={applying}
                    onClick={() => void confirm()}
                    className="inline-flex min-h-[38px] items-center gap-2 rounded-lg bg-[#2563EB] px-4 text-sm font-semibold text-white hover:bg-[#1D4ED8] disabled:opacity-70"
                  >
                    {applying ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
                    Confirm {plan.changes.length} change{plan.changes.length > 1 ? 's' : ''}
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setPlan(null);
                      toast.ok('Cancelled. Nothing changed.');
                    }}
                    className="inline-flex min-h-[38px] items-center rounded-lg border border-[#CBD5E1] bg-white px-4 text-sm font-semibold text-[#0F172A] hover:bg-[#F8FAFC]"
                  >
                    Cancel
                  </button>
                  <span className="text-xs text-[#64748B]">Nothing changes until you confirm. You can undo afterwards.</span>
                </div>
              </>
            )}
            {plan.intent === 'action' && !plan.changes.length && !plan.errors.length && <span className="text-[13px] text-[#64748B]">Nothing needs changing: it’s already like that.</span>}

            {(plan.intent === 'question' || plan.intent === 'unclear') && plan.cars.length > 0 && (
              <div className="flex flex-wrap gap-1.5">
                {plan.cars.slice(0, 24).map((c) => (
                  <Link
                    key={c.id}
                    href={`/dealer/inventory/${c.id}`}
                    onClick={() => setPlan(null)}
                    className="rounded-full bg-[#EAF1FF] px-2.5 py-1 text-[12.5px] font-semibold text-[#1D4ED8] hover:bg-[#DBE7FE]"
                    title={[c.ext, money(c.price), `${c.photos} photos`].filter(Boolean).join(' · ')}
                  >
                    {c.name}
                    {c.stock ? ` · ${c.stock}` : ''}
                  </Link>
                ))}
                {plan.cars.length > 24 && <span className="text-xs text-[#64748B]">+{plan.cars.length - 24} more</span>}
              </div>
            )}
            {plan.intent === 'unclear' && <span className="text-[13px] text-[#64748B]">Try being more specific, e.g. add the year, colour or stock number.</span>}
            {plan.intent !== 'action' && (
              <div>
                <button type="button" onClick={() => searchInventory(plan.search || planText)} className="text-[13px] font-semibold text-[#1D4ED8] hover:underline">
                  Search the inventory for “{plan.search || planText}” →
                </button>
              </div>
            )}
          </div>
        </div>
      )}

      {undo && (
        <div className="fixed bottom-5 left-1/2 z-[110] flex -translate-x-1/2 items-center gap-4 rounded-xl bg-[#0F172A] px-4 py-3 text-sm text-white shadow-[0_10px_30px_rgba(15,23,42,0.3)]">
          <span>✓ {undo.msg}</span>
          <button type="button" onClick={() => void doUndo()} className="font-bold text-[#93C5FD] hover:underline">
            Undo
          </button>
          <button type="button" onClick={() => setUndo(null)} aria-label="Close" className="text-[#94A3B8]">
            <X className="h-4 w-4" />
          </button>
        </div>
      )}
    </div>
  );
}

/**
 * Voice like a WhatsApp voice note: tap to start, tap again to stop. The words appear in the box first;
 * nothing runs until the dealer presses Go. Chrome / Edge / Safari use the browser's own speech recognition
 * (free, instant); other browsers record the voice and the AI turns it into words.
 */
export function VoiceButton({ onText, onError, onDone }: { onText: (t: string) => void; onError: (m: string) => void; onDone?: () => void }) {
  const [state, setState] = useState<'idle' | 'rec' | 'busy'>('idle');
  const [secs, setSecs] = useState(0);
  const rec = useRef<any>(null);
  const media = useRef<MediaRecorder | null>(null);
  const on = useRef(false);
  const useServer = useRef(false);
  const committed = useRef('');

  useEffect(() => {
    if (state !== 'rec') return;
    setSecs(0);
    const t0 = Date.now();
    const i = setInterval(() => setSecs(Math.floor((Date.now() - t0) / 1000)), 500);
    return () => clearInterval(i);
  }, [state]);

  const finish = () => {
    on.current = false;
    setState('idle');
    onDone?.();
  };

  const startBrowser = (SR: any) => {
    committed.current = '';
    const r = new SR();
    r.lang = 'en-US';
    r.continuous = true;
    r.interimResults = false;
    r.onresult = (e: any) => {
      for (let i = e.resultIndex; i < e.results.length; i++) if (e.results[i].isFinal) onText(String(e.results[i][0].transcript).trim());
    };
    r.onerror = (e: any) => {
      if (e.error === 'not-allowed' || e.error === 'service-not-allowed') {
        on.current = false;
        onError('Allow microphone access to use voice.');
      } else if (e.error === 'network') {
        on.current = false;
        useServer.current = true;
        onError("Browser voice isn't available here. Tap the microphone again to record instead.");
      }
    };
    // keep listening through pauses until the dealer taps stop
    r.onend = () => {
      if (on.current) {
        try {
          r.start();
        } catch {
          finish();
        }
      } else finish();
    };
    rec.current = r;
    on.current = true;
    r.start();
    setState('rec');
  };

  const startRecorder = async () => {
    if (!navigator.mediaDevices || !(window as any).MediaRecorder) {
      onError("Voice isn't supported in this browser. Please type instead.");
      return;
    }
    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch {
      onError('Allow microphone access to use voice.');
      return;
    }
    const chunks: Blob[] = [];
    const m = new MediaRecorder(stream);
    m.ondataavailable = (e) => e.data.size && chunks.push(e.data);
    m.onstop = async () => {
      stream.getTracks().forEach((t) => t.stop());
      setState('busy');
      try {
        const wav = await extractAudio(new Blob(chunks, { type: m.mimeType }), 60);
        if (!wav || !wav.data) throw new Error(wav?.silent ? 'No voice was heard. Please try again.' : "Couldn't read the recording. Please type instead.");
        const r = await aiApi<{ text: string }>('transcribe', { audio: wav.data });
        if (r.text) onText(r.text);
      } catch (e) {
        onError((e as Error).message);
      }
      finish();
    };
    media.current = m;
    on.current = true;
    m.start();
    setState('rec');
  };

  const click = () => {
    if (state === 'rec') {
      on.current = false;
      if (rec.current) {
        rec.current.stop();
        rec.current = null;
      } else if (media.current?.state === 'recording') media.current.stop();
      else finish();
      return;
    }
    const SR = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (SR && !useServer.current) startBrowser(SR);
    else void startRecorder();
  };

  return (
    <>
      {state === 'rec' && (
        <span className="hidden items-center gap-1.5 whitespace-nowrap text-xs font-semibold text-[#B91C1C] sm:inline-flex">
          <i className="h-2 w-2 animate-pulse rounded-full bg-[#DC2626]" />
          {Math.floor(secs / 60)}:{String(secs % 60).padStart(2, '0')}
        </span>
      )}
      <button
        type="button"
        onClick={click}
        disabled={state === 'busy'}
        title={state === 'rec' ? 'Tap to stop' : 'Tap to speak. Tap again to stop.'}
        aria-label={state === 'rec' ? 'Stop recording' : 'Speak instead of typing'}
        className={cx(
          'inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg transition',
          state === 'rec' ? 'bg-[#FEE2E2] text-[#B91C1C]' : 'text-[#526077] hover:bg-[#EEF1F6] hover:text-[#0F172A]',
        )}
      >
        {state === 'busy' ? <Loader2 className="h-4 w-4 animate-spin" /> : state === 'rec' ? <Square className="h-3.5 w-3.5 fill-current" /> : <Mic className="h-[18px] w-[18px]" />}
      </button>
    </>
  );
}
