import SadhanaSection from '@/components/guide/SadhanaSection';
import type { SadhanaGroupOption } from '@/components/guide/ReportsTab';

interface Props {
  bvslId: string;
  hideImprovement?: boolean;
  groupOptions?: SadhanaGroupOption[];
}

export default function BvslSadhanaReportPanel({ bvslId, hideImprovement = false, groupOptions = [] }: Props) {
  return <SadhanaSection guideId={bvslId} bvslMode={true} hideImprovement={hideImprovement} groupOptions={groupOptions} />;
}
