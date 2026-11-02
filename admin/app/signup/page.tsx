'use client';

import { useEffect } from 'react';
import { DEALER_PORTAL_URL } from '@/lib/api';
import { Loading } from '@/components/ui';

/** Dealer sign-up lives in the Dealership Portal app. This folder can be deleted. */
export default function MovedSignup() {
  useEffect(() => {
    window.location.href = `${DEALER_PORTAL_URL}/signup`;
  }, []);
  return <Loading />;
}
