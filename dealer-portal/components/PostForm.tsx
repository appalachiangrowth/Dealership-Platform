'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Trash2 } from 'lucide-react';
import { api, siteUrl } from '@/lib/api';
import { useToast } from './toast';
import { useTenant } from './DealerShell';
import { SingleImage } from './ImageUploader';
import { Button, Card, Field, Input, PageHeader, Textarea } from './ui';

export function PostForm({ initial }: { initial: Record<string, any> }) {
  const [p, setP] = useState(initial);
  const [busy, setBusy] = useState(false);
  const router = useRouter();
  const toast = useToast();
  const { tenant } = useTenant();
  const set = (k: string, v: unknown) => setP((x) => ({ ...x, [k]: v }));

  async function save(status: string) {
    setBusy(true);
    try {
      const body = {
        title: p.title, excerpt: p.excerpt, body: p.body, coverImage: p.coverImage, category: p.category, author: p.author,
        metaTitle: p.metaTitle, metaDescription: p.metaDescription, status, publishedAt: p.publishedAt || undefined,
        tags: String(p.tagsText ?? (p.tags || []).join(', ')).split(',').map((s) => s.trim()).filter(Boolean),
      };
      const out = p.id ? await api(`/dealer/posts/${p.id}`, { method: 'PATCH', body }) : await api('/dealer/posts', { body });
      toast.ok('Post saved');
      if (!p.id) router.replace(`/dealer/blog/${out.id}`);
      else setP(out);
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
        desc={p.id && p.status === 'PUBLISHED' && tenant ? <a className="text-blue-700 underline" href={`${siteUrl(tenant)}/index.html#/blog`} target="_blank" rel="noreferrer">View on website</a> : undefined}
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
        <Card className="lg:col-span-2">
          <div className="space-y-4">
            <Field label="Title">
              <Input value={p.title || ''} onChange={(e) => set('title', e.target.value)} />
            </Field>
            <Field label="Short excerpt" hint="Shown on the blog list.">
              <Textarea rows={2} value={p.excerpt || ''} onChange={(e) => set('excerpt', e.target.value)} />
            </Field>
            <Field label="Article" hint="Leave a blank line between paragraphs. ## for a heading. Links: [text](https://…)">
              <Textarea rows={18} value={p.body || ''} onChange={(e) => set('body', e.target.value)} />
            </Field>
          </div>
        </Card>
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
