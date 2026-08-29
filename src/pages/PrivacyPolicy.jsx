import { ArrowLeft, ShieldCheck } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { lang } from '@/lib/i18n';
import PageTransition from '@/components/common/PageTransition';
import privacyPolicy from '@/data/privacy-policy.json';
import supportContact from '@/data/support-contact.json';

function getLocale() {
  return lang === 'pt' ? 'pt-BR' : 'en-US';
}

function formatEffectiveDate(value, locale) {
  const parsed = new Date(`${value}T00:00:00Z`);
  return new Intl.DateTimeFormat(locale, {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    timeZone: 'UTC',
  }).format(parsed);
}

export default function PrivacyPolicy() {
  const navigate = useNavigate();
  const locale = getLocale();
  const document = privacyPolicy.locales[locale] || privacyPolicy.locales['en-US'];
  const effectiveDate = formatEffectiveDate(privacyPolicy.effectiveDate, locale);
  const labels = locale === 'pt-BR'
    ? {
        publicPolicy: 'Política pública do Voxyl',
        effective: 'Vigente desde',
        version: 'Versão',
        operator: 'Publicado por',
        contact: 'Contato de suporte e privacidade',
      }
    : {
        publicPolicy: 'Public Voxyl policy',
        effective: 'Effective',
        version: 'Version',
        operator: 'Published by',
        contact: 'Support and privacy contact',
      };

  const handleBack = () => {
    if (window.history.length > 1) {
      navigate(-1);
      return;
    }

    navigate('/');
  };

  return (
    <PageTransition>
      <div className="min-h-screen bg-background">
        <div
          className="sticky top-0 z-10 glass border-b border-border px-4 py-4 flex items-center gap-3"
          style={{ paddingTop: 'calc(env(safe-area-inset-top, 0px) + 1rem)' }}
        >
          <button
            type="button"
            onClick={handleBack}
            className="w-8 h-8 rounded-full bg-secondary flex items-center justify-center"
            aria-label={locale === 'pt-BR' ? 'Voltar' : 'Back'}
          >
            <ArrowLeft size={16} />
          </button>
          <h1 className="font-grotesk font-bold text-base">{document.title}</h1>
        </div>

        <main className="px-5 py-6 max-w-3xl mx-auto pb-16">
          <div className="rounded-2xl border border-primary/20 bg-primary/5 p-4 mb-7">
            <div className="flex items-start gap-3">
              <ShieldCheck size={20} className="text-primary mt-0.5 flex-shrink-0" />
              <div>
                <p className="text-sm font-semibold text-foreground">{labels.publicPolicy}</p>
                <div className="mt-1 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
                  <span>{labels.effective}: {effectiveDate}</span>
                  <span>{labels.version}: {privacyPolicy.version}</span>
                  <span>{labels.operator}: {privacyPolicy.operator}</span>
                </div>
              </div>
            </div>
          </div>

          <div className="space-y-3 mb-8">
            {document.intro.map((paragraph) => (
              <p key={paragraph} className="text-sm text-muted-foreground leading-relaxed">
                {paragraph}
              </p>
            ))}
          </div>

          <div className="space-y-8">
            {document.sections.map((section) => (
              <section key={section.title}>
                <h2 className="font-grotesk font-semibold text-base text-foreground mb-3">
                  {section.title}
                </h2>

                {section.paragraphs?.length > 0 && (
                  <div className="space-y-3">
                    {section.paragraphs.map((paragraph) => (
                      <p key={paragraph} className="text-sm text-muted-foreground leading-relaxed">
                        {paragraph}
                      </p>
                    ))}
                  </div>
                )}

                {section.items?.length > 0 && (
                  <ul className="space-y-2">
                    {section.items.map((item) => (
                      <li key={item} className="text-sm text-muted-foreground leading-relaxed flex gap-2">
                        <span className="text-primary mt-1 flex-shrink-0" aria-hidden="true">•</span>
                        <span>{item}</span>
                      </li>
                    ))}
                  </ul>
                )}
              </section>
            ))}
          </div>

          <section className="mt-8 rounded-2xl border border-border bg-secondary/40 p-4">
            <h2 className="font-grotesk font-semibold text-base text-foreground mb-2">
              {labels.contact}
            </h2>
            <a
              href={`mailto:${supportContact.supportEmail}`}
              className="text-sm text-primary underline underline-offset-4 break-all"
            >
              {supportContact.supportEmail}
            </a>
          </section>

          <div className="mt-10 pt-6 border-t border-border text-xs text-muted-foreground leading-relaxed">
            <p>{privacyPolicy.publicUrl}</p>
          </div>
        </main>
      </div>
    </PageTransition>
  );
}
