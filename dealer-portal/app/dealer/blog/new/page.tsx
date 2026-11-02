'use client';

import { useSession } from '@/lib/session';
import { PostForm } from '@/components/PostForm';

export default function NewPost() {
  const { me } = useSession();
  return <PostForm initial={{ title: '', excerpt: '', body: '', status: 'DRAFT', author: me?.user.name || '', publishedAt: new Date().toISOString() }} />;
}
