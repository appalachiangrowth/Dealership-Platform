'use client';

import { useEffect } from 'react';
import { DEALER_PORTAL_URL } from '@/lib/api';
import { Loading } from '@/components/ui';

/**
 * The Dealership Portal is its own app now (dealer-portal folder, http://localhost:3000).
 * This folder is no longer used by the Platform Admin and can be deleted.
 */
export default function MovedDealerLayout() {
  useEffect(() => {
    window.location.href = DEALER_PORTAL_URL + window.location.pathname + window.location.search;
  }, []);
  return <Loading />;
}
