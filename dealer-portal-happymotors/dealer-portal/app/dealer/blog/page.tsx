'use client';

import Link from 'next/link';
import { Plus } from 'lucide-react';
import { useApi } from '@/lib/useApi';
import { mediaUrl } from '@/lib/api';
import { Card, Empty, ErrorBox, LinkButton, Loading, PageHeader, StatusBadge, Table, Td } from '@/components/ui';
import { date } from '@/lib/format';

export default function BlogPage() {
  const { data, loading, error, reload } = useApi('/dealer/posts');
  return (
    <>
      <PageHeader
        title="Blog & news"
        desc="Announcements and helpful articles. Published posts appear on your website’s blog page."
        actions={
          <LinkButton href="/dealer/blog/new" variant="success">
            <Plus className="h-4 w-4" /> New post
          </LinkButton>
        }
      />
      <Card pad={false}>
        {loading ? (
          <Loading />
        ) : error ? (
          <div className="p-4">
            <ErrorBox error={error} retry={reload} />
          </div>
        ) : (
          <Table head={['Post', 'Category', 'Published', 'Status']} empty={!data?.length && <Empty title="No posts yet" action={<LinkButton href="/dealer/blog/new">Write your first post</LinkButton>} />}>
            {data?.map((p: any) => (
              <tr key={p.id} className="hover:bg-slate-50">
                <Td>
                  <Link href={`/dealer/blog/${p.id}`} className="flex items-center gap-3">
                    <div className="h-10 w-14 overflow-hidden rounded bg-slate-100">{p.coverImage && <img src={mediaUrl(p.coverImage)} alt="" className="h-full w-full object-cover" />}</div>
                    <div>
                      <div className="font-semibold text-slate-900">{p.title}</div>
                      <div className="max-w-md truncate text-xs text-slate-500">{p.excerpt}</div>
                    </div>
                  </Link>
                </Td>
                <Td>{p.category || '—'}</Td>
                <Td>{date(p.publishedAt)}</Td>
                <Td>
                  <StatusBadge status={p.status} />
                </Td>
              </tr>
            ))}
          </Table>
        )}
      </Card>
    </>
  );
}
