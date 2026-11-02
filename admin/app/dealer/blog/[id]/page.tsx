'use client';

import { useParams } from 'next/navigation';
import { useApi } from '@/lib/useApi';
import { ErrorBox, Loading } from '@/components/ui';
import { PostForm } from '@/components/PostForm';

export default function EditPost() {
  const { id } = useParams<{ id: string }>();
  const { data, loading, error } = useApi(`/dealer/posts/${id}`);
  if (loading) return <Loading />;
  if (error) return <ErrorBox error={error} />;
  return data ? <PostForm key={data.id} initial={data} /> : null;
}
