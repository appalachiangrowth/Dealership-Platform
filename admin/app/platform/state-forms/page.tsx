'use client';

import { Card, PageHeader } from '@/components/ui';
import { StateFormTemplates } from '@/components/StateFormTemplates';

/** Platform Admin › State forms: the official fillable Virginia VSA 17A used by every dealership's deals. */
export default function StateFormsPage() {
  return (
    <>
      <PageHeader
        title="State forms (VA VSA 17A)"
        desc="Upload the official fillable VSA 17A once for all dealerships. Its fields are detected and matched to deal values; adjust the mapping and test with sample data. A dealership’s own upload (Business details) wins."
      />
      <Card title="Virginia VSA 17A - Application for Certificate of Title and Registration">
        <StateFormTemplates base="/platform/state-forms" scope="platform" />
      </Card>
    </>
  );
}
