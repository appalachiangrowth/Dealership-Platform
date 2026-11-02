'use client';

import { useEffect, useState } from 'react';
import { api } from './api';
import { useToast } from '@/components/toast';

/** Loads /dealer/settings and saves only the given keys. */
export function useSettings(keys: string[]) {
  const [form, setForm] = useState<Record<string, any> | null>(null);
  const [original, setOriginal] = useState<Record<string, any>>({});
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const toast = useToast();

  useEffect(() => {
    api('/dealer/settings')
      .then((r) => {
        setForm(r.settings);
        setOriginal(r.settings);
      })
      .catch((e) => setError(e.message));
  }, []);

  const set = (k: string, v: unknown) => setForm((f) => ({ ...(f || {}), [k]: v }));
  const dirty = !!form && keys.some((k) => JSON.stringify(form[k]) !== JSON.stringify(original[k]));

  async function save(extra: Record<string, unknown> = {}) {
    if (!form) return;
    setSaving(true);
    try {
      const patch: Record<string, unknown> = { ...extra };
      for (const k of keys) {
        const v = form[k];
        if (v && typeof v === 'object' && 'set' in v) continue; // untouched secret
        patch[k] = v;
      }
      const r = await api('/dealer/settings', { method: 'PATCH', body: patch });
      setForm(r.settings);
      setOriginal(r.settings);
      toast.ok('Saved');
      return true;
    } catch (e) {
      toast.error((e as Error).message);
      return false;
    } finally {
      setSaving(false);
    }
  }

  return { form, set, save, saving, dirty, error };
}
