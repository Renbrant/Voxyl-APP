import { Link } from 'react-router-dom';
import {
  ArrowLeft,
  ArrowRight,
  Apple,
  CheckCircle2,
  Clock,
  Download,
  Mail,
  Smartphone,
  Users,
} from 'lucide-react';
import { lang, setLanguage } from '@/lib/i18n';
import supportContact from '@/data/support-contact.json';

// Joining this Google Group is what makes someone a tester: the group is
// attached to the closed testing track in Play Console, so no email is
// collected or stored by Voxyl.
export const BETA_GROUP_URL = 'https://groups.google.com/g/voxyl-beta-testers';
export const BETA_OPT_IN_URL = 'https://play.google.com/apps/testing/com.renbrant.voxyl';
export const PLAY_STORE_URL = 'https://play.google.com/store/apps/details?id=com.renbrant.voxyl';
const FEEDBACK_EMAIL = supportContact.supportEmail;

const copy = {
  pt: {
    back: 'Voltar ao início',
    eyebrow: 'Programa beta · Android',
    title: 'Seja um beta tester do Voxyl',
    intro: 'Ajude a lançar o Voxyl na Google Play. Você recebe o app antes de todo mundo e o seu uso conta para a liberação oficial na loja.',
    accountTitle: 'Use a mesma conta Google do seu celular',
    accountBody: 'Faça os três passos com a conta Google que está na Play Store do seu Android. É por ela que o Google reconhece você como testador.',
    step: 'Passo',
    step1Title: 'Entre no grupo de testadores',
    step1Body: 'Abra o grupo e toque em “Participar do grupo”. Não precisa preencher nada além disso.',
    step1Button: 'Entrar no grupo',
    step2Title: 'Aceite o convite de teste',
    step2Body: 'Abra a página de teste da Google Play e toque em “Tornar-se testador”. Se a página disser que você não tem acesso, aguarde alguns minutos depois de entrar no grupo e tente de novo.',
    step2Button: 'Aceitar o convite',
    step3Title: 'Instale o Voxyl',
    step3Body: 'Instale pela Google Play. As próximas versões de teste chegam como atualizações normais da loja.',
    step3Button: 'Abrir na Google Play',
    keepTitle: 'Fique no teste por pelo menos 14 dias',
    keepBody: 'O Google só libera o app para todos depois que os testadores participam por 14 dias seguidos. Não saia do grupo e mantenha o app instalado nesse período.',
    androidOnlyTitle: 'Só para Android',
    androidOnlyBody: 'Por enquanto o teste é apenas na Google Play. No iPhone, você pode usar o Voxyl pelo navegador.',
    androidOnlyLink: 'Abrir no navegador',
    feedbackTitle: 'Encontrou um problema ou tem uma sugestão?',
    feedbackBody: 'Escreva para',
    privacy: 'O Voxyl não guarda o seu e-mail nesta página. A lista de testadores é o próprio grupo do Google, e você pode sair dele quando quiser.',
  },
  en: {
    back: 'Back to home',
    eyebrow: 'Beta program · Android',
    title: 'Become a Voxyl beta tester',
    intro: 'Help launch Voxyl on Google Play. You get the app before everyone else, and your participation counts toward the official store release.',
    accountTitle: 'Use the same Google account as your phone',
    accountBody: 'Do all three steps with the Google account signed in to the Play Store on your Android phone. That is how Google recognizes you as a tester.',
    step: 'Step',
    step1Title: 'Join the testers group',
    step1Body: 'Open the group and tap “Join group”. Nothing else to fill in.',
    step1Button: 'Join the group',
    step2Title: 'Accept the test invitation',
    step2Body: 'Open the Google Play testing page and tap “Become a tester”. If it says you do not have access, wait a few minutes after joining the group and try again.',
    step2Button: 'Accept the invitation',
    step3Title: 'Install Voxyl',
    step3Body: 'Install it from Google Play. New test versions arrive as regular store updates.',
    step3Button: 'Open on Google Play',
    keepTitle: 'Stay in the test for at least 14 days',
    keepBody: 'Google only releases the app to everyone after testers take part for 14 days in a row. Please stay in the group and keep the app installed during that time.',
    androidOnlyTitle: 'Android only',
    androidOnlyBody: 'For now the test is only on Google Play. On iPhone, you can use Voxyl in the browser.',
    androidOnlyLink: 'Open in the browser',
    feedbackTitle: 'Found a problem or have a suggestion?',
    feedbackBody: 'Write to',
    privacy: 'Voxyl does not store your email on this page. The tester list is the Google Group itself, and you can leave it at any time.',
  },
};

const externalLink = { target: '_blank', rel: 'noreferrer' };

export default function BetaTesters() {
  const c = copy[lang] || copy.pt;

  const steps = [
    { title: c.step1Title, body: c.step1Body, button: c.step1Button, href: BETA_GROUP_URL, Icon: Users },
    { title: c.step2Title, body: c.step2Body, button: c.step2Button, href: BETA_OPT_IN_URL, Icon: CheckCircle2 },
    { title: c.step3Title, body: c.step3Body, button: c.step3Button, href: PLAY_STORE_URL, Icon: Download },
  ];

  return (
    <div className="min-h-screen overflow-x-hidden bg-[#0f0d0b] text-white">
      <div className="pointer-events-none fixed inset-x-0 top-0 h-[520px] bg-[radial-gradient(circle_at_50%_-10%,rgba(249,116,21,0.22),transparent_58%)]" />

      <header className="sticky top-0 z-50 border-b border-white/5 bg-[#0f0d0b]/85 backdrop-blur-xl">
        <div className="mx-auto flex h-16 max-w-4xl items-center justify-between px-4 sm:px-6">
          <Link to="/" className="flex items-center gap-2.5" aria-label="Voxyl">
            <img src="/branding/voxyl-symbol-transparent.png" alt="" className="h-9 w-9 object-contain" />
            <span className="font-grotesk text-xl font-bold text-gradient">Voxyl</span>
          </Link>
          <div className="flex rounded-full border border-white/10 bg-white/5 p-1">
            {['pt', 'en'].map(code => (
              <button
                key={code}
                type="button"
                onClick={() => setLanguage(code)}
                className={`rounded-full px-2.5 py-1 text-[11px] font-semibold uppercase transition ${
                  lang === code ? 'bg-white/10 text-white' : 'text-white/40 hover:text-white/70'
                }`}
              >
                {code}
              </button>
            ))}
          </div>
        </div>
      </header>

      <main className="relative mx-auto max-w-4xl px-4 pb-24 pt-10 sm:px-6 sm:pt-16">
        <Link to="/" className="inline-flex items-center gap-2 text-sm text-white/50 transition hover:text-white">
          <ArrowLeft className="h-4 w-4" />
          {c.back}
        </Link>

        <div className="mt-8 inline-flex items-center gap-2 rounded-full border border-orange-500/20 bg-orange-500/10 px-3 py-1.5 text-xs font-semibold uppercase tracking-[0.16em] text-orange-300">
          <Smartphone className="h-3.5 w-3.5" />
          {c.eyebrow}
        </div>
        <h1 className="mt-5 font-grotesk text-4xl font-bold leading-[1.08] tracking-[-0.03em] sm:text-5xl">
          {c.title}
        </h1>
        <p className="mt-5 max-w-2xl text-base leading-7 text-white/60 sm:text-lg">{c.intro}</p>

        <div className="mt-8 rounded-3xl border border-orange-500/25 bg-orange-500/[0.07] p-5 sm:p-6">
          <h2 className="font-grotesk text-lg font-semibold text-orange-200">{c.accountTitle}</h2>
          <p className="mt-2 text-sm leading-6 text-white/60">{c.accountBody}</p>
        </div>

        <ol className="mt-8 grid gap-4">
          {steps.map(({ title, body, button, href, Icon }, index) => (
            <li key={href} className="rounded-3xl border border-white/8 bg-white/[0.035] p-6">
              <div className="flex items-start gap-4">
                <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-orange-500/12 text-orange-400">
                  <Icon className="h-5 w-5" />
                </div>
                <div className="min-w-0 flex-1">
                  <p className="text-xs font-semibold uppercase tracking-[0.16em] text-orange-400">
                    {c.step} {index + 1}
                  </p>
                  <h3 className="mt-1 font-grotesk text-xl font-semibold">{title}</h3>
                  <p className="mt-2 text-sm leading-6 text-white/55">{body}</p>
                  <a
                    href={href}
                    {...externalLink}
                    className="mt-4 inline-flex min-h-11 items-center justify-center gap-2 rounded-2xl bg-orange-500 px-5 py-2.5 text-sm font-semibold text-white transition hover:bg-orange-400"
                  >
                    {button}
                    <ArrowRight className="h-4 w-4" />
                  </a>
                </div>
              </div>
            </li>
          ))}
        </ol>

        <div className="mt-8 grid gap-4 md:grid-cols-2">
          <div className="rounded-3xl border border-white/8 bg-white/[0.035] p-6">
            <Clock className="h-6 w-6 text-orange-400" />
            <h2 className="mt-4 font-grotesk text-lg font-semibold">{c.keepTitle}</h2>
            <p className="mt-2 text-sm leading-6 text-white/55">{c.keepBody}</p>
          </div>
          <div className="rounded-3xl border border-white/8 bg-white/[0.035] p-6">
            <Apple className="h-6 w-6 text-orange-400" />
            <h2 className="mt-4 font-grotesk text-lg font-semibold">{c.androidOnlyTitle}</h2>
            <p className="mt-2 text-sm leading-6 text-white/55">{c.androidOnlyBody}</p>
            <Link to="/app" className="mt-3 inline-flex items-center gap-1.5 text-sm font-semibold text-orange-300 hover:text-orange-200">
              {c.androidOnlyLink}
              <ArrowRight className="h-4 w-4" />
            </Link>
          </div>
        </div>

        <div className="mt-8 rounded-3xl border border-white/8 bg-white/[0.02] p-6">
          <div className="flex items-center gap-3">
            <Mail className="h-5 w-5 text-orange-400" />
            <h2 className="font-grotesk text-lg font-semibold">{c.feedbackTitle}</h2>
          </div>
          <p className="mt-2 text-sm leading-6 text-white/55">
            {c.feedbackBody}{' '}
            <a href={`mailto:${FEEDBACK_EMAIL}`} className="font-semibold text-orange-300 hover:text-orange-200">
              {FEEDBACK_EMAIL}
            </a>
          </p>
        </div>

        <p className="mt-8 text-xs leading-5 text-white/35">{c.privacy}</p>
      </main>
    </div>
  );
}
