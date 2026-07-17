// Service reminder notifications — schedules browser notifications before each service slot

const ICON = 'https://images.fillout.com/orgid-615562/flowpublicid-u91plgmzcu/widgetid-default/q1fJEkENG5kbvfjYaFbDeT/pasted-image-1773145742081.png';

interface ServiceForReminder {
  allocationId: string;
  serviceName: string;
  timeSlot: string;
  status: string;
}

// Track scheduled timeout IDs so we can cancel them
const scheduledTimeouts: ReturnType<typeof setTimeout>[] = [];

export function clearServiceReminders() {
  scheduledTimeouts.splice(0).forEach(id => clearTimeout(id));
}

/** Parse "5:00 AM", "6:30 PM", "17:30" → { hours, minutes } */
function parseTimeSlot(timeSlot: string): { hours: number; minutes: number } | null {
  if (!timeSlot) return null;
  const amPm = timeSlot.trim().match(/^(\d{1,2}):(\d{2})\s*(AM|PM)$/i);
  if (amPm) {
    let h = parseInt(amPm[1]);
    const m = parseInt(amPm[2]);
    const isPm = amPm[3].toUpperCase() === 'PM';
    if (isPm && h !== 12) h += 12;
    if (!isPm && h === 12) h = 0;
    return { hours: h, minutes: m };
  }
  const h24 = timeSlot.trim().match(/^(\d{1,2}):(\d{2})$/);
  if (h24) {
    return { hours: parseInt(h24[1]), minutes: parseInt(h24[2]) };
  }
  return null;
}

function fireNotification(title: string, body: string, tag: string) {
  if (!('Notification' in window) || Notification.permission !== 'granted') return;
  try {
    const n = new Notification(title, { body, icon: ICON, tag });
    n.onclick = () => { window.focus(); n.close(); };
  } catch {}
}

/** Schedule 30/15/5 min reminders for all of today's services. Call once when services load. */
export function scheduleServiceReminders(services: ServiceForReminder[]) {
  if (!('Notification' in window) || Notification.permission !== 'granted') return;

  clearServiceReminders();

  const now = new Date();
  const today = now.toISOString().slice(0, 10);

  for (const svc of services) {
    if (svc.status === 'completed' || svc.status === 'Done') continue;
    const parsed = parseTimeSlot(svc.timeSlot);
    if (!parsed) continue;

    const serviceTime = new Date(`${today}T00:00:00`);
    serviceTime.setHours(parsed.hours, parsed.minutes, 0, 0);

    const REMINDERS = [
      { offsetMs: 30 * 60 * 1000, label: '30 minutes', urgency: '' },
      { offsetMs: 15 * 60 * 1000, label: '15 minutes', urgency: '— get ready!' },
      { offsetMs: 5 * 60 * 1000, label: '5 minutes', urgency: '— please head over now 🙏' },
    ];

    for (const { offsetMs, label, urgency } of REMINDERS) {
      const fireAt = serviceTime.getTime() - offsetMs;
      const delay = fireAt - now.getTime();
      if (delay <= 0) continue; // Already past — skip

      const id = setTimeout(() => {
        fireNotification(
          `⏰ ${svc.serviceName} in ${label}`,
          `Your service starts in ${label} ${urgency}`.trim(),
          `svc-reminder-${svc.allocationId}-${label}`,
        );
      }, delay);
      scheduledTimeouts.push(id);
    }
  }
}
