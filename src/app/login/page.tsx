import { LoginForm } from './login-form';

/**
 * Server component so the `?error=` the OAuth callback redirects with is read
 * on the server. Doing it client-side would need useSearchParams, which forces
 * this route into a Suspense boundary and out of static rendering.
 */
export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const { error } = await searchParams;
  return (
    <LoginForm oauthError={error} shopNumber={process.env.NEXT_PUBLIC_WHATSAPP_NUMBER} />
  );
}
