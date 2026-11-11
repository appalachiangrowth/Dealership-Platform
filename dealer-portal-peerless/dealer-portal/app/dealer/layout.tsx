import { DealerShell } from '@/components/DealerShell';

export default function DealerLayout({ children }: { children: React.ReactNode }) {
  return <DealerShell>{children}</DealerShell>;
}
