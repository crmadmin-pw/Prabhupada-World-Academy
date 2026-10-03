import SadhanaSection from '@/components/guide/SadhanaSection';

interface Props { bvslId: string; hideImprovement?: boolean; }

export default function BvslSadhanaReportPanel({ bvslId, hideImprovement = false }: Props) {
  return <SadhanaSection guideId={bvslId} bvslMode={true} hideImprovement={hideImprovement} />;
}
