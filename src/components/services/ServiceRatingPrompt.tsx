import { useState, useEffect } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { Star, Eye, EyeOff, CheckCircle2, X } from 'lucide-react';
import { toast } from 'sonner';
import { getServiceRatingsForDate, submitServiceRating } from 'zite-endpoints-sdk';
import type { GetServiceRatingsForDateOutputType } from 'zite-endpoints-sdk';

type ServiceItem = GetServiceRatingsForDateOutputType['services'][0];

interface Props {
  onDismiss: () => void;
}

function StarRating({ value, onChange }: { value: number; onChange: (v: number) => void }) {
  const [hovered, setHovered] = useState(0);
  return (
    <div className="flex gap-1">
      {[1, 2, 3, 4, 5].map(n => (
        <button
          key={n}
          type="button"
          onClick={() => onChange(n)}
          onMouseEnter={() => setHovered(n)}
          onMouseLeave={() => setHovered(0)}
          className="transition-transform hover:scale-110"
        >
          <Star
            className={`w-7 h-7 ${
              n <= (hovered || value)
                ? 'fill-yellow-400 text-yellow-400'
                : 'text-muted-foreground/30'
            }`}
          />
        </button>
      ))}
    </div>
  );
}

const RATING_LABELS = ['', 'Poor', 'Below Average', 'Average', 'Good', 'Excellent'];

export default function ServiceRatingPrompt({ onDismiss }: Props) {
  const [services, setServices] = useState<ServiceItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [ratings, setRatings] = useState<Record<string, number>>({});
  const [comments, setComments] = useState<Record<string, string>>({});
  const [submitting, setSubmitting] = useState<Record<string, boolean>>({});
  const [submitted, setSubmitted] = useState<Record<string, boolean>>({});
  const [step, setStep] = useState(0); // which service we're rating now
  const [date, setDate] = useState('');

  useEffect(() => {
    load();
  }, []);

  const load = async () => {
    try {
      const res = await getServiceRatingsForDate({});
      setDate(res.date);
      setServices(res.services);
      // Pre-mark already rated services
      const preSubmitted: Record<string, boolean> = {};
      for (const s of res.services) {
        if (s.hasRated) preSubmitted[s.serviceId] = true;
      }
      setSubmitted(preSubmitted);
    } catch {
      toast.error('Failed to load services');
    } finally {
      setLoading(false);
    }
  };

  const unratedServices = services.filter(s => !submitted[s.serviceId]);

  const handleRate = async (serviceId: string) => {
    const rating = ratings[serviceId];
    if (!rating) { toast.error('Please select a rating'); return; }
    setSubmitting(prev => ({ ...prev, [serviceId]: true }));
    try {
      const res = await submitServiceRating({
        serviceId,
        ratingDate: date,
        rating,
        comment: comments[serviceId] || undefined,
      });
      if (res.alreadyRated) {
        toast.info('You have already rated this service today');
      } else {
        toast.success('Rating submitted 🙏 (anonymous)');
      }
      setSubmitted(prev => ({ ...prev, [serviceId]: true }));
      // Advance to next unrated service
      const nextIdx = unratedServices.findIndex(s => s.serviceId === serviceId);
      if (nextIdx < unratedServices.length - 2) setStep(nextIdx + 1);
    } catch {
      toast.error('Failed to submit rating');
    } finally {
      setSubmitting(prev => ({ ...prev, [serviceId]: false }));
    }
  };

  if (loading) return (
    <Card className="border-primary/30 bg-primary/5">
      <CardContent className="py-6 text-center text-sm text-muted-foreground">Loading services…</CardContent>
    </Card>
  );

  if (unratedServices.length === 0 && Object.keys(submitted).length === 0) return null;

  const allDone = unratedServices.length === 0;
  const current = unratedServices[step] ?? unratedServices[0];

  return (
    <Card className="border-primary/30 bg-gradient-to-br from-primary/5 to-background">
      <CardHeader className="pb-3">
        <div className="flex items-start justify-between gap-2">
          <div>
            <CardTitle className="text-base flex items-center gap-2">
              <Star className="w-4 h-4 text-yellow-500 fill-yellow-500" />
              Rate Today's Services
            </CardTitle>
            <p className="text-xs text-muted-foreground mt-1 flex items-center gap-1.5">
              <EyeOff className="w-3 h-3" />
              Fully anonymous — nobody can see who gave which rating
            </p>
          </div>
          <button onClick={onDismiss} className="text-muted-foreground hover:text-foreground p-1">
            <X className="w-4 h-4" />
          </button>
        </div>
      </CardHeader>

      <CardContent className="space-y-4">
        {allDone ? (
          <div className="text-center py-4">
            <CheckCircle2 className="w-10 h-10 text-green-500 mx-auto mb-2" />
            <p className="font-medium text-sm">All rated — thank you! 🙏</p>
            <p className="text-xs text-muted-foreground mt-1">Your anonymous feedback helps everyone improve</p>
            <Button variant="outline" size="sm" className="mt-3" onClick={onDismiss}>Close</Button>
          </div>
        ) : (
          <>
            {/* Progress */}
            <div className="flex gap-1">
              {services.map((s, i) => (
                <div
                  key={s.serviceId}
                  className={`h-1 flex-1 rounded-full ${
                    submitted[s.serviceId] ? 'bg-green-500' : i === step ? 'bg-primary' : 'bg-muted'
                  }`}
                />
              ))}
            </div>

            {current && (
              <div className="space-y-3">
                <div>
                  <p className="font-semibold text-sm">{current.serviceName}</p>
                  {current.timeSlot && (
                    <p className="text-xs text-muted-foreground">{current.timeSlot}</p>
                  )}
                </div>

                <StarRating
                  value={ratings[current.serviceId] ?? 0}
                  onChange={v => setRatings(prev => ({ ...prev, [current.serviceId]: v }))}
                />
                {ratings[current.serviceId] > 0 && (
                  <p className="text-xs font-medium text-primary">{RATING_LABELS[ratings[current.serviceId]]}</p>
                )}

                <Textarea
                  placeholder="Optional comment (anonymous)"
                  className="h-16 text-xs resize-none"
                  value={comments[current.serviceId] ?? ''}
                  onChange={e => setComments(prev => ({ ...prev, [current.serviceId]: e.target.value }))}
                  maxLength={200}
                />

                <div className="flex justify-between items-center">
                  <span className="text-xs text-muted-foreground">
                    {services.filter(s => submitted[s.serviceId]).length}/{services.length} rated
                  </span>
                  <Button
                    size="sm"
                    onClick={() => handleRate(current.serviceId)}
                    disabled={!ratings[current.serviceId] || submitting[current.serviceId]}
                  >
                    {submitting[current.serviceId] ? 'Submitting…' : 'Submit Rating'}
                  </Button>
                </div>

                {unratedServices.length > 1 && (
                  <div className="flex gap-1 flex-wrap">
                    {unratedServices.map((s, i) => (
                      <button
                        key={s.serviceId}
                        onClick={() => setStep(i)}
                        className={`text-xs px-2 py-0.5 rounded-full border ${i === step ? 'bg-primary text-primary-foreground border-primary' : 'border-border hover:bg-muted'}`}
                      >
                        {s.serviceName.split(' ').slice(0, 2).join(' ')}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
}
