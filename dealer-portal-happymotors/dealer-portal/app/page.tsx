'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useSession } from '@/lib/session';
import { Loading } from '@/components/ui';

/** Dealership Portal home: logged in → the portal, otherwise → login. */
export default function Home() {
  const { me, loading } = useSession();
  const router = useRouter();
  useEffect(() => {
    if (loading) return;
    router.replace(me ? '/dealer' : '/login');
  }, [me, loading, router]);
  return <Loading />;
}
