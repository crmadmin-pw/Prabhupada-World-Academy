interface Props {
  value: string;
  onChange: (v: string) => void;
}

const STATUSES = [
  { value: 'White', bg: 'bg-white border-2 border-muted-foreground/30', ring: 'ring-muted-foreground/50', emoji: '⬜' },
  { value: 'Yellow', bg: 'bg-yellow-400', ring: 'ring-yellow-500', emoji: '🟡' },
  { value: 'Green', bg: 'bg-green-500', ring: 'ring-green-600', emoji: '🟢' },
  { value: 'Red', bg: 'bg-red-500', ring: 'ring-red-600', emoji: '🔴' },
];

export default function StatusButtons({ value, onChange }: Props) {
  return (
    <div className="flex gap-1.5">
      {STATUSES.map(s => (
        <button
          key={s.value}
          type="button"
          onClick={() => onChange(s.value)}
          className={`w-7 h-7 rounded-full ${s.bg} transition-all flex items-center justify-center text-sm
            ${value === s.value ? `ring-2 ${s.ring} ring-offset-1 scale-110` : 'opacity-60 hover:opacity-90'}`}
          title={s.value}
        >
          {value === s.value && s.value === 'White' && '✓'}
        </button>
      ))}
    </div>
  );
}
