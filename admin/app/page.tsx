'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useSession } from '@/lib/session';
import { auth, DEALER_PORTAL_URL } from '@/lib/api';
import { Loading } from '@/components/ui';

/** Platform Admin home: owners → /platform, dealer logins belong in the Dealership Portal. */
export default function Home() {
  const { me, loading } = useSession();
  const router = useRouter();
  useEffect(() => {
    if (loading) return;
    if (!me) router.replace('/login');
    else if (me.user.kind === 'owner') router.replace('/platform');
    else {
      auth.clear();
      window.location.href = DEALER_PORTAL_URL;
    }
  }, [me, loading, router]);
  return <Loading />;
}
