const TOKEN_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789';

export function generateBvJoinToken(): string {
  let token = '';
  for (let i = 0; i < 16; i++) token += TOKEN_ALPHABET[Math.floor(Math.random() * TOKEN_ALPHABET.length)];
  return token;
}

/** PW invites end with /pw and still carry the group token in the path. */
export function bvWhatsAppJoinUrl(origin: string, token: string, isPw: boolean): string {
  const safeToken = encodeURIComponent(token);
  return isPw
    ? `${origin}/join/${safeToken}/pw`
    : `${origin}/join-group?token=${safeToken}`;
}

/** WhatsApp, Facebook and Instagram open links in a browser that blocks Google's sign-in window. */
export function isEmbeddedInviteBrowser(userAgent?: string): boolean {
  const agent = userAgent ?? (typeof navigator === 'undefined' ? '' : navigator.userAgent);
  return /WhatsApp|FBAN|FBAV|Instagram|Line\//i.test(agent || '');
}

/** Open WhatsApp's "send to" composer with the invite already filled in.
 * wa.me requires a phone number. `wa.me/?text=` has nowhere to go and stays
 * on WhatsApp's loading screen. */
export function bvWhatsAppShareUrl(message: string): string {
  return `https://api.whatsapp.com/send?text=${encodeURIComponent(message)}`;
}
