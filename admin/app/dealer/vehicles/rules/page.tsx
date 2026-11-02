'use client';

import { useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { useApi } from '@/lib/useApi';
import { useToast } from '@/components/toast';
import { Button, Card, ErrorBox, Loading, PageHeader, Toggle } from '@/components/ui';

export default function RulesPage() {
  const { data, loading, error } = useApi('/dealer/vehicles/field-rules');
  const [rules, setRules] = useState<Record<string, string>>({});
  const [skipDraft, setSkipDraft] = useState(true);
  const [busy, setBusy] = useState(false);
  const toast = useToast();
  useEffect(() => {
    if (data) {
      setRules(data.rules);
      setSkipDraft(data.skipDraft);
    }
  }, [data]);
  if (loading) return <Loading />;
  if (error) return <ErrorBox error={error} />;
  if (!data) return null;
  return (
    <>
      <PageHeader
        back="/dealer/vehicles"
        title="Field rules"
        desc="Choose which fields must be filled in before a vehicle can be saved."
        actions={
          <>
            <Button variant="secondary" onClick={() => setRules(Object.fromEntries(data.cargurusSet.map((k: string) => [k, 'required'])))}>
              Use CarGurus required set
            </Button>
            <Button
              loading={busy}
              onClick={async () => {
                setBusy(true);
                try {
                  await api('/dealer/vehicles/field-rules', { method: 'PUT', body: { rules, skipDraft } });
                  toast.ok('Field rules saved');
                } catch (e) {
                  toast.error((e as Error).message);
                } finally {
                  setBusy(false);
                }
              }}
            >
              Save
            </Button>
          </>
        }
      />
      <Card className="max-w-3xl">
        <div className="mb-5">
          <Toggle checked={skipDraft} onChange={setSkipDraft} label="Drafts can be saved with missing fields" desc="The rules apply when a vehicle is published." />
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          {Object.entries<string>(data.fields).map(([k, label]) => (
            <div key={k} className="flex items-center justify-between rounded-lg border border-slate-200 px-4 py-2.5">
              <span className="text-sm font-medium text-slate-700">{label}</span>
              <Toggle
                checked={rules[k] === 'required'}
                onChange={(on) => {
                  const next = { ...rules };
                  if (on) next[k] = 'required';
                  else delete next[k];
                  setRules(next);
                }}
              />
            </div>
          ))}
        </div>
      </Card>
    </>
  );
}
