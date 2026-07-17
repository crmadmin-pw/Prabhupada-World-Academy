import React from 'react';
import { Card, CardContent } from '@/components/ui/card';

interface StatCardProps {
  icon: React.ComponentType<{ className?: string }>;
  iconColor?: string;
  value: string | number;
  label: string;
  sublabel?: string;
}

export default function StatCard({ icon: Icon, iconColor = 'text-primary', value, label, sublabel }: StatCardProps) {
  return (
    <Card>
      <CardContent className="pt-4 pb-3 text-center">
        <Icon className={`w-6 h-6 ${iconColor} mx-auto mb-1`} />
        <div className="text-2xl font-bold">{value}</div>
        <p className="text-xs text-muted-foreground mt-0.5">{label}</p>
        {sublabel && <p className="text-xs text-muted-foreground/70">{sublabel}</p>}
      </CardContent>
    </Card>
  );
}
