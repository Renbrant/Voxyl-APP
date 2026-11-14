import { useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { ShieldCheck, Loader2 } from 'lucide-react';
import { useAuth } from '@/lib/AuthContext';
import { voxylApi } from '@/api/voxylApiClient';
import { t } from '@/lib/i18n';
import termsOfUse from '@/data/terms-of-use.json';

export const TERMS_OF_USE_VERSION = termsOfUse.version;

// Routes a signed-out or not-yet-accepted user must still be able to read.
const PUBLIC_LEGAL_PATHS = ['/terms', '/privacy', '/account-deletion'];

// Blocks the app until the current Terms of Use are accepted. The Worker enforces
// the same rule for content creation, so this screen is the normal path, not the
// only guard.
export default function TermsAcceptanceGate() {
  const { user, isAuthenticated, logout, checkUserAuth } = useAuth();
  const location = useLocation();
  const [agreed, setAgreed] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

  if (PUBLIC_LEGAL_PATHS.includes(location.pathname)) return null;
  if (!isAuthenticated || !user) return null;
  if (user.terms_accepted_version === TERMS_OF_USE_VERSION) return null;

  const handleAccept = async () => {
    if (!agreed || submitting) return;

    setSubmitting(true);
    setError('');

    try {
      await voxylApi.auth.acceptTerms(TERMS_OF_USE_VERSION);
      await checkUserAuth?.();
    } catch (acceptError) {
      setError(acceptError?.status === 409
        ? t('termsGateVersionChanged')
        : t('termsGateError'));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="terms-gate-title"
      className="fixed inset-0 z-[70] flex items-end justify-center bg-black/70 backdrop-blur-sm"
    >
      <div
        className="w-full max-w-md bg-card border-t border-border rounded-t-3xl p-5 max-h-[90vh] overflow-y-auto"
        style={{ paddingBottom: 'calc(env(safe-area-inset-bottom, 0px) + 1.5rem)' }}
      >
        <div className="flex items-center gap-3 mb-3">
          <ShieldCheck size={20} className="text-primary flex-shrink-0" />
          <h2 id="terms-gate-title" className="text-base font-grotesk font-bold">
            {t('termsGateTitle')}
          </h2>
        </div>

        <p className="text-sm text-muted-foreground mb-4">{t('termsGateBody')}</p>

        <div className="flex flex-wrap gap-x-4 gap-y-2 text-sm mb-4">
          <Link to="/terms" className="text-primary underline underline-offset-4">
            {t('termsGateReadTerms')}
          </Link>
          <Link to="/privacy" className="text-primary underline underline-offset-4">
            {t('termsGateReadPrivacy')}
          </Link>
        </div>

        <label className="flex items-start gap-3 text-sm text-foreground mb-4 cursor-pointer">
          <input
            type="checkbox"
            checked={agreed}
            onChange={(event) => setAgreed(event.target.checked)}
            className="mt-1 h-4 w-4 accent-primary"
          />
          <span>{t('termsGateCheckbox')}</span>
        </label>

        {error && <p className="text-xs text-destructive mb-3">{error}</p>}

        <button
          type="button"
          onClick={handleAccept}
          disabled={!agreed || submitting}
          className="w-full py-3 rounded-2xl gradient-primary text-white font-semibold text-sm flex items-center justify-center gap-2 disabled:opacity-50"
        >
          {submitting && <Loader2 size={16} className="animate-spin" />}
          {t('termsGateAccept')}
        </button>

        <button
          type="button"
          onClick={() => logout()}
          className="w-full py-3 mt-2 rounded-2xl bg-secondary text-muted-foreground text-sm font-medium"
        >
          {t('termsGateLogout')}
        </button>
      </div>
    </div>
  );
}
