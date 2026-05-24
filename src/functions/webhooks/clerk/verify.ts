import { Webhook } from 'svix';

export function verifySvixSignature(
  body: string,
  headers: Record<string, string>,
  secret: string,
): boolean {
  try {
    const webhook = new Webhook(secret);
    webhook.verify(body, headers);
    return true;
  } catch (error) {
    console.error('Svix verification failed:', error);
    return false;
  }
}
