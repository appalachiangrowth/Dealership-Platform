'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { CheckCircle2, Link2, Trash2, XCircle } from 'lucide-react';
import { api, siteBase, siteUrl } from '@/lib/api';
import { useToast } from './toast';
import { useTenant } from './DealerShell';
import { SingleImage } from './ImageUploader';
import { RichTextEditor } from './RichTextEditor';
import { Button, Card, Field, Input, PageHeader, Textarea } from './ui';

/** same rules as the API (backend common/util.ts slugify): lower case, a-z 0-9 and single "-", max 80 */
export function slugifyUrl(s: string, max = 80) {
  return String(s || '')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, max)
    .replace(/-+$/g, '');
}

type SlugState = { state: 'idle' | 'checking' | 'ok' | 'taken' | 'empty' | 'error'; slug: string };

export function PostForm({ initial }: { initial: Record<string, any> }) {
  const [p, setP] = useState(initial);
  const [busy, setBusy] = useState(false);
  const router = useRouter();
  const toast = useToast();
  const { tenant } = useTenant();
  const set = (k: string, v: unknown) => setP((x) => ({ ...x, [k]: v }));
  // Custom URL: a new post follows its title until the dealer edits the URL; a saved post keeps its own URL
  const [slugEdited, setSlugEdited] = useState<boolean>(!!initial.id);
  const slug: string = slugEdited ? String(p.slug ?? '') : slugifyUrl(p.title || '');
  const [check, setCheck] = useState<SlugState>({ state: 'idle', slug: '' });
  const prefix = (tenant ? siteBase(tenant).base : '') + '/blog/';

  useEffect(() => {
    const clean = slugifyUrl(slug);
    if (!clean) {
      setCheck({ state: 'empty', slug: '' });
      return;
    }
    setCheck((c) => ({ state: 'checking', slug: c.slug }));
    let live = true;
    const t = setTimeout(async () => {
      try {
        const r = await api<{ slug: string; available: boolean }>(`/dealer/posts/slug-check?slug=${encodeURIComponent(clean)}${p.id ? `&id=${encodeURIComponent(p.id)}` : ''}`);
        if (live) setCheck({ state: r.available ? 'ok' : 'taken', slug: r.slug });
      } catch {
        if (live) setCheck({ state: 'error', slug: clean });
      }
    }, 350);
    return () => {
      live = false;
      clearTimeout(t);
    };
  }, [slug, p.id]);

  /** taken custom URL: saving would be refused by the API (409), so it is stopped here with the reason */
  const slugBlocked = slugEdited && check.state === 'taken';

  async function save(status: string) {
    if (slugBlocked) {
      toast.error(`The URL /blog/${check.slug} is already used by another post. Choose a different one.`);
      return;
    }
    setBusy(true);
    try {
      const body = {
        title: p.title, excerpt: p.excerpt, body: p.body, coverImage: p.coverImage, category: p.category, author: p.author,
        metaTitle: p.metaTitle, metaDescription: p.metaDescription, status, publishedAt: p.publishedAt || undefined,
        tags: String(p.tagsText ?? (p.tags || []).join(', ')).split(',').map((s) => s.trim()).filter(Boolean),
        // empty = made from the title by the API (a number is added when that address is taken)
        slug: slugEdited ? slugifyUrl(slug) : '',
      };
      const out = p.id ? await api(`/dealer/posts/${p.id}`, { method: 'PATCH', body }) : await api('/dealer/posts', { body });
      toast.ok('Post saved');
      if (!p.id) router.replace(`/dealer/blog/${out.id}`);
      else {
        setP(out);
        setSlugEdited(true);
      }
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <PageHeader
        back="/dealer/blog"
        title={p.id ? 'Edit post' : 'New post'}
        desc={p.id && p.status === 'PUBLISHED' && tenant ? <a className="text-blue-700 underline" href={siteUrl(tenant, p.slug ? `blog/${encodeURIComponent(p.slug)}` : 'blog')} target="_blank" rel="noreferrer">View on website</a> : undefined}
        actions={
          <>
            {p.id && (
              <Button
                variant="ghost"
                onClick={async () => {
                  if (!confirm('Delete this post?')) return;
                  await api(`/dealer/posts/${p.id}`, { method: 'DELETE' });
                  router.replace('/dealer/blog');
                }}
              >
                <Trash2 className="h-4 w-4" />
              </Button>
            )}
            <Button variant="secondary" onClick={() => save('DRAFT')} loading={busy}>
              Save draft
            </Button>
            <Button variant="success" onClick={() => save('PUBLISHED')} loading={busy}>
              Publish
            </Button>
          </>
        }
      />
      <div className="grid gap-6 lg:grid-cols-3">
        <div className="space-y-6 lg:col-span-2">
        <Card>
          <div className="space-y-4">
            <Field label="Title">
              <Input value={p.title || ''} onChange={(e) => set('title', e.target.value)} />
            </Field>
            <Field label="Short excerpt" hint="Shown on the blog list.">
              <Textarea rows={2} value={p.excerpt || ''} onChange={(e) => set('excerpt', e.target.value)} />
            </Field>
            <div>
              <div className="mb-1.5 flex flex-wrap items-baseline justify-between gap-2">
                <span className="text-sm font-medium text-slate-700">Article</span>
                <span className="text-xs text-slate-500">Headings, fonts, colors, lists, links and pictures appear on your website exactly as here.</span>
              </div>
              {/* the editor keeps its own content while typing: a new key only when another post is opened */}
              <RichTextEditor key={p.id || 'new'} value={initial.body || ''} onChange={(html) => set('body', html)} />
            </div>
          </div>
        </Card>
        <Card title="Custom URL / Slug">
          <div className="space-y-2">
            <div className="flex flex-wrap items-stretch overflow-hidden rounded-lg border border-slate-300 bg-white focus-within:border-blue-500 focus-within:ring-2 focus-within:ring-blue-100">
              <span className="flex max-w-full items-center gap-1.5 truncate border-r border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-500" title={prefix}>
                <Link2 className="h-4 w-4 shrink-0" />
                <span className="truncate">{prefix}</span>
              </span>
              <input
                className="min-w-[10rem] flex-1 px-3 py-2 text-sm text-slate-900 outline-none"
                value={slug}
                placeholder="my-article-title"
                spellCheck={false}
                aria-label="Custom URL / Slug"
                onChange={(e) => {
                  setSlugEdited(true);
                  // letters, numbers and "-" only while typing (spaces become "-")
                  set('slug', e.target.value.toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '').replace(/-{2,}/g, '-').slice(0, 80));
                }}
                onBlur={() => slugEdited && set('slug', slugifyUrl(slug))}
              />
            </div>
            <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
              <span>
                {check.state === 'empty' && (
                  <span className="inline-flex items-center gap-1 text-red-600">
                    <XCircle className="h-3.5 w-3.5" /> The URL is empty{p.title ? ' — it will be made from the title when you save.' : '. Enter a URL or a title.'}
                  </span>
                )}
                {check.state === 'checking' && <span className="text-slate-500">Checking…</span>}
                {check.state === 'ok' && (
                  <span className="inline-flex items-center gap-1 text-emerald-700">
                    <CheckCircle2 className="h-3.5 w-3.5" /> Available: {prefix}
                    {check.slug}
                  </span>
                )}
                {check.state === 'taken' && (
                  <span className="inline-flex items-center gap-1 text-red-600">
                    <XCircle className="h-3.5 w-3.5" />
                    {slugEdited ? 'Already used by another post — choose a different URL.' : `Already used by another post — it will be saved as ${check.slug}-2 (or the next free number).`}
                  </span>
                )}
                {check.state === 'error' && <span className="text-amber-700">Could not check the URL right now; it is checked again when you save.</span>}
              </span>
              {slugEdited && p.title && slugifyUrl(p.title) !== slugifyUrl(slug) && (
                <button type="button" className="font-medium text-blue-700 hover:underline" onClick={() => set('slug', slugifyUrl(p.title))}>
                  Use the title
                </button>
              )}
            </div>
            <p className="text-xs text-slate-500">Lower-case letters, numbers and hyphens. Changing the URL of a published post: the old address stops working, so update any links you shared.</p>
          </div>
        </Card>
        </div>
        <div className="space-y-6">
          <Card title="Cover image">
            <SingleImage value={p.coverImage || ''} onChange={(v) => set('coverImage', v)} folder="" />
          </Card>
          <Card title="Details">
            <div className="space-y-4">
              <Field label="Category">
                <Input value={p.category || ''} onChange={(e) => set('category', e.target.value)} placeholder="Buying tips" />
              </Field>
              <Field label="Tags" hint="Comma separated">
                <Input value={p.tagsText ?? (p.tags || []).join(', ')} onChange={(e) => set('tagsText', e.target.value)} />
              </Field>
              <Field label="Author">
                <Input value={p.author || ''} onChange={(e) => set('author', e.target.value)} />
              </Field>
              <Field label="Publish date">
                <Input type="date" value={(p.publishedAt || '').slice(0, 10)} onChange={(e) => set('publishedAt', e.target.value)} />
              </Field>
              <Field label="Google title">
                <Input value={p.metaTitle || ''} onChange={(e) => set('metaTitle', e.target.value)} />
              </Field>
              <Field label="Google description">
                <Textarea rows={3} value={p.metaDescription || ''} onChange={(e) => set('metaDescription', e.target.value)} />
              </Field>
            </div>
          </Card>
        </div>
      </div>
    </>
  );
}
