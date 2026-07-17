import SadhanaSection from '@/components/guide/SadhanaSection';

interface Props { bvslId: string; }

export default function BvslSadhanaReportPanel({ bvslId }: Props) {
  return <SadhanaSection guideId={bvslId} bvslMode={true} />;
}
