import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Plus, X, Image as ImageIcon, Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { uploadFile } from 'zite-file-upload-sdk';

export type ChecklistItem = { text: string; imageUrl?: string };

interface Props {
  items: ChecklistItem[];
  onChange: (items: ChecklistItem[]) => void;
}

export default function ChecklistBuilder({ items, onChange }: Props) {
  const [uploading, setUploading] = useState<Record<number, boolean>>({});

  const addItem = () => onChange([...items, { text: '' }]);
  const removeItem = (i: number) => onChange(items.filter((_, idx) => idx !== i));
  const updateText = (i: number, text: string) =>
    onChange(items.map((item, idx) => (idx === i ? { ...item, text } : item)));
  const removeImage = (i: number) =>
    onChange(items.map((item, idx) => (idx === i ? { ...item, imageUrl: undefined } : item)));

  const handleUpload = async (i: number, file: File) => {
    setUploading(u => ({ ...u, [i]: true }));
    try {
      const { fileUrl } = await uploadFile({ data: file, filename: file.name });
      onChange(items.map((item, idx) => (idx === i ? { ...item, imageUrl: fileUrl } : item)));
    } catch {
      toast.error('Failed to upload image');
    } finally {
      setUploading(u => ({ ...u, [i]: false }));
    }
  };

  return (
    <div className="space-y-2">
      <div>
        <Label>Checklist Items</Label>
        <p className="text-xs text-muted-foreground mt-0.5">
          Add the sub-tasks users must complete for this service
        </p>
      </div>
      {items.length === 0 && (
        <p className="text-xs text-muted-foreground italic py-1">No items yet. Click "Add Item" to start.</p>
      )}
      {items.map((item, i) => (
        <div key={i} className="space-y-1">
          <div className="flex items-center gap-2">
            <span className="text-xs text-muted-foreground w-5 text-right shrink-0">{i + 1}.</span>
            <Input
              value={item.text}
              onChange={e => updateText(i, e.target.value)}
              placeholder={`Task ${i + 1}…`}
              className="text-sm flex-1"
            />
            <label className="cursor-pointer shrink-0">
              <input
                type="file"
                accept="image/*"
                className="hidden"
                onChange={e => {
                  const f = e.target.files?.[0];
                  if (f) handleUpload(i, f);
                  e.target.value = '';
                }}
              />
              <div className="h-9 w-9 flex items-center justify-center rounded-md border border-border hover:bg-muted/50 text-muted-foreground transition-colors">
                {uploading[i] ? (
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                ) : (
                  <ImageIcon className="w-3.5 h-3.5" />
                )}
              </div>
            </label>
            <Button
              type="button"
              size="icon"
              variant="ghost"
              className="h-9 w-9 shrink-0 text-destructive hover:text-destructive"
              onClick={() => removeItem(i)}
            >
              <X className="w-3.5 h-3.5" />
            </Button>
          </div>
          {item.imageUrl && (
            <div className="flex items-center gap-2 ml-7">
              <img src={item.imageUrl} className="h-12 w-12 object-cover rounded border" alt="" />
              <button
                type="button"
                onClick={() => removeImage(i)}
                className="text-xs text-destructive hover:underline"
              >
                Remove image
              </button>
            </div>
          )}
        </div>
      ))}
      <Button type="button" variant="outline" size="sm" onClick={addItem} className="w-full text-xs mt-1">
        <Plus className="w-3.5 h-3.5 mr-1" /> Add Item
      </Button>
    </div>
  );
}
