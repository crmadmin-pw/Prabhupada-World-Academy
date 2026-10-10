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
