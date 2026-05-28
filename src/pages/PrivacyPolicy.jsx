import { ArrowLeft } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { t } from '@/lib/i18n';
import PageTransition from '@/components/common/PageTransition';

const getSections = () => [
  {
    title: t('privacy1Title'),
    content: [t('privacy1_1'), t('privacy1_2'), t('privacy1_3'), t('privacy1_4')],
  },
  {
    title: t('privacy2Title'),
    content: [t('privacy2_1'), t('privacy2_2'), t('privacy2_3'), t('privacy2_4'), t('privacy2_5')],
  },
  {
    title: t('privacy3Title'),
    content: [t('privacy3_1'), t('privacy3_2'), t('privacy3_3')],
  },
  {
    title: t('privacy4Title'),
    content: [t('privacy4_1'), t('privacy4_2')],
  },
  {
    title: t('privacy5Title'),
    content: [t('privacy5_1'), t('privacy5_2'), t('privacy5_3'), t('privacy5_4')],
  },
  {
    title: t('privacy6Title'),
    content: [t('privacy6_1'), t('privacy6_2'), t('privacy6_3')],
  },
  {
    title: t('privacy7Title'),
    content: [t('privacy7_1'), t('privacy7_2')],
  },
  {
    title: t('privacy8Title'),
    content: [t('privacy8_1')],
  },
  {
    title: t('privacy9Title'),
    content: [t('privacy9_1')],
  },
];

export default function PrivacyPolicy() {
  const navigate = useNavigate();
  const sections = getSections();

  return (
    <PageTransition>
    <div className="min-h-screen bg-background">
      {/* Header */}
      <div className="sticky top-0 z-10 glass border-b border-border px-4 py-4 flex items-center gap-3"
        style={{ paddingTop: 'calc(env(safe-area-inset-top, 0px) + 1rem)' }}>
        <button onClick={() => navigate(-1)} className="w-8 h-8 rounded-full bg-secondary flex items-center justify-center">
          <ArrowLeft size={16} />
        </button>
        <h1 className="font-grotesk font-bold text-base">{t('privacyTitle')}</h1>
      </div>

      <div className="px-5 py-6 max-w-2xl mx-auto pb-16">
        <p className="text-xs text-muted-foreground mb-6">{t('privacyLastUpdate')}</p>

        <p className="text-sm text-muted-foreground mb-8">
          <strong className="text-foreground">Voxyl</strong> {t('privacyIntro')}
        </p>

        <div className="space-y-7">
          {sections.map((s) => (
            <div key={s.title}>
              <h2 className="font-grotesk font-semibold text-sm text-foreground mb-2">{s.title}</h2>
              <ul className="space-y-1.5">
                {s.content.map((line, i) => (
                  <li key={i} className="text-sm text-muted-foreground leading-relaxed flex gap-2">
                    <span className="text-primary mt-1 flex-shrink-0">•</span>
                    <span dangerouslySetInnerHTML={{ __html: line.replace(/\*\*(.*?)\*\*/g, '<strong class="text-foreground">$1</strong>') }} />
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>

        {/* Data Deletion Section */}
        <div className="mt-10 rounded-2xl border border-destructive/30 bg-destructive/5 overflow-hidden">
          <div className="p-5 pb-0">
            <h2 className="font-grotesk font-bold text-base text-foreground mb-2">{t('privacyDeleteTitle')}</h2>
            <p className="text-sm text-muted-foreground leading-relaxed mb-4">
              {t('privacyDeleteDesc')}
            </p>
          </div>

          <div className="px-5 pb-5">
            <ol className="space-y-4">
              {[
                { icon: '📱', title: t('privacyDeleteStep1Title'), text: t('privacyDeleteStep1') },
                { icon: '✋', title: t('privacyDeleteStep2Title'), text: t('privacyDeleteStep2') },
                { icon: '🔓', title: t('privacyDeleteStep3Title'), text: t('privacyDeleteStep3') },
                { icon: '🗑️', title: t('privacyDeleteStep4Title'), text: t('privacyDeleteStep4') },
                { icon: '✅', title: t('privacyDeleteStep5Title'), text: t('privacyDeleteStep5') },
              ].map((step, i) => (
                <li key={i} className="flex gap-4 items-start">
                  <div className="w-8 h-8 rounded-full bg-card border border-border flex items-center justify-center flex-shrink-0 text-sm">
                    {step.icon}
                  </div>
                  <div>
                    <p className="text-sm font-semibold text-foreground">{step.title}</p>
                    <p className="text-sm text-muted-foreground leading-relaxed mt-0.5">{step.text}</p>
                  </div>
                </li>
              ))}
            </ol>

            <div className="mt-5 p-3 rounded-xl bg-destructive/10 border border-destructive/20">
              <p className="text-xs text-destructive font-medium">
                {t('privacyDeleteWarning')}
              </p>
            </div>

            <p className="text-xs text-muted-foreground mt-4 leading-relaxed">
              {t('privacyDeleteEmail').split('privacy@voxyl.app').map((part, i) => (
                i === 0 ? part : [<a key={i} href="mailto:privacy@voxyl.app" className="text-primary underline">privacy@voxyl.app</a>, part]
              ))}
            </p>
          </div>
        </div>
      </div>
    </div>
    </PageTransition>
  );
}