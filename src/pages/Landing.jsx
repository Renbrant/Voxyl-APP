import { Link } from 'react-router-dom';
import {
  Apple,
  ArrowRight,
  Check,
  Chrome,
  Download,
  Globe2,
  Headphones,
  ListMusic,
  Radio,
  Share2,
  Smartphone,
  Sparkles,
  Users,
} from 'lucide-react';
import { lang, setLanguage } from '@/lib/i18n';

const APK_DOWNLOAD_URL = 'https://github.com/Renbrant/Voxyl-APP/releases/download/v0.4.5/Voxyl-v0.4.5-release.apk';
const RELEASES_URL = 'https://github.com/Renbrant/Voxyl-APP/releases/latest';

const copy = {
  pt: {
    navHow: 'Como funciona',
    navFeatures: 'Recursos',
    navInstall: 'Instalar atalho',
    openApp: 'Começar a ouvir',
    eyebrow: 'Podcasts do seu jeito',
    heroTitleA: 'Descubra, organize e compartilhe',
    heroTitleB: 'o que vale a pena ouvir.',
    heroBody: 'O Voxyl é uma plataforma social de podcasts para descobrir conteúdo, criar playlists com diferentes feeds, acompanhar pessoas e continuar ouvindo de onde você parou.',
    browserBadge: 'Sem instalação obrigatória',
    browserTitle: 'Abra no navegador e comece a ouvir.',
    browserBody: 'O Voxyl funciona diretamente no browser do seu celular ou computador. Não é necessário baixar ou instalar um aplicativo para usar a experiência principal.',
    browserCta: 'Abrir Voxyl no navegador',
    freeGuest: 'Explore conteúdo público sem criar uma conta.',
    sectionHowEyebrow: 'Simples desde o primeiro acesso',
    sectionHowTitle: 'Você escolhe como quer usar o Voxyl.',
    sectionHowBody: 'Use direto pelo navegador, adicione um atalho à tela inicial ou instale o APK no Android.',
    optionBrowserTitle: 'Usar no navegador',
    optionBrowserBody: 'A opção mais rápida. Abra o Voxyl no Chrome, Safari, Edge ou outro navegador moderno e comece a ouvir.',
    optionShortcutTitle: 'Adicionar à tela inicial',
    optionShortcutBody: 'Tenha um ícone do Voxyl como se fosse um app, sem precisar baixar uma loja de aplicativos.',
    optionApkTitle: 'Instalar o APK no Android',
    optionApkBody: 'Para quem prefere uma instalação nativa no Android, o APK oficial da versão beta está disponível no GitHub.',
    currentBeta: 'Beta atual: v0.4.5',
    featuresEyebrow: 'Mais do que um player',
    featuresTitle: 'Uma experiência feita para ouvir e descobrir em comunidade.',
    featureDiscoverTitle: 'Descubra podcasts',
    featureDiscoverBody: 'Encontre podcasts e playlists públicas criadas pela comunidade.',
    featurePlaylistTitle: 'Crie suas playlists',
    featurePlaylistBody: 'Combine episódios e feeds em coleções do seu jeito.',
    featurePeopleTitle: 'Siga pessoas',
    featurePeopleBody: 'Acompanhe outros ouvintes e descubra o que eles estão organizando e ouvindo.',
    featureContinueTitle: 'Continue de onde parou',
    featureContinueBody: 'O progresso de reprodução permite retomar seus episódios com facilidade.',
    featureShareTitle: 'Compartilhe',
    featureShareBody: 'Compartilhe playlists e ajude outras pessoas a descobrir conteúdo interessante.',
    featureGuestTitle: 'Use sem login',
    featureGuestBody: 'Explore conteúdo público como visitante. Entre apenas quando quiser recursos pessoais e sociais.',
    installEyebrow: 'Quer um ícone na tela inicial?',
    installTitle: 'Instale um atalho em poucos segundos.',
    installBody: 'O Voxyl é uma PWA. Isso significa que você pode adicioná-lo à tela inicial e abrir em modo de aplicativo, sem precisar instalar pela App Store ou Play Store.',
    androidTitle: 'Android · Chrome',
    androidStep1: 'Abra v.renbrant.com no Chrome.',
    androidStep2: 'Toque no menu de três pontos.',
    androidStep3: 'Escolha “Adicionar à tela inicial” ou “Instalar app”.',
    androidStep4: 'Confirme para criar o ícone do Voxyl.',
    iosTitle: 'iPhone / iPad · Safari',
    iosStep1: 'Abra v.renbrant.com no Safari.',
    iosStep2: 'Toque no botão Compartilhar.',
    iosStep3: 'Escolha “Adicionar à Tela de Início”.',
    iosStep4: 'Toque em “Adicionar”.',
    apkEyebrow: 'Prefere instalar no Android?',
    apkTitle: 'Baixe o APK oficial do Voxyl.',
    apkBody: 'Durante a fase beta, a versão Android também pode ser instalada diretamente pelo APK publicado no GitHub. O Android pode pedir permissão para instalar aplicativos de fontes externas.',
    apkButton: 'Baixar APK v0.4.5',
    releasesButton: 'Ver releases no GitHub',
    finalTitle: 'Pronto para ouvir?',
    finalBody: 'Abra o Voxyl agora mesmo. Nenhuma instalação é necessária.',
    finalButton: 'Começar a ouvir',
    beta: 'Voxyl está em beta',
    footer: 'Voxyl · Social Podcast Playlists',
  },
  en: {
    navHow: 'How it works',
    navFeatures: 'Features',
    navInstall: 'Install shortcut',
    openApp: 'Start listening',
    eyebrow: 'Podcasts, your way',
    heroTitleA: 'Discover, organize and share',
    heroTitleB: 'what is worth listening to.',
    heroBody: 'Voxyl is a social podcast platform for discovering content, building playlists across different feeds, following people and resuming right where you stopped.',
    browserBadge: 'No installation required',
    browserTitle: 'Open your browser and start listening.',
    browserBody: 'Voxyl runs directly in your phone or computer browser. You do not need to download or install an app to use the core experience.',
    browserCta: 'Open Voxyl in the browser',
    freeGuest: 'Explore public content without creating an account.',
    sectionHowEyebrow: 'Simple from the first visit',
    sectionHowTitle: 'Choose how you want to use Voxyl.',
    sectionHowBody: 'Use it directly in your browser, add a home-screen shortcut, or install the Android APK.',
    optionBrowserTitle: 'Use the browser',
    optionBrowserBody: 'The fastest option. Open Voxyl in Chrome, Safari, Edge or another modern browser and start listening.',
    optionShortcutTitle: 'Add to your home screen',
    optionShortcutBody: 'Keep a Voxyl icon like a regular app without downloading anything from an app store.',
    optionApkTitle: 'Install the Android APK',
    optionApkBody: 'If you prefer a native Android installation, the official beta APK is available on GitHub.',
    currentBeta: 'Current beta: v0.4.5',
    featuresEyebrow: 'More than a player',
    featuresTitle: 'A listening and discovery experience built around people.',
    featureDiscoverTitle: 'Discover podcasts',
    featureDiscoverBody: 'Find podcasts and public playlists curated by the community.',
    featurePlaylistTitle: 'Build your playlists',
    featurePlaylistBody: 'Combine episodes and feeds into collections that fit the way you listen.',
    featurePeopleTitle: 'Follow people',
    featurePeopleBody: 'Follow other listeners and discover what they are organizing and listening to.',
    featureContinueTitle: 'Continue listening',
    featureContinueBody: 'Playback progress makes it easy to resume your episodes.',
    featureShareTitle: 'Share',
    featureShareBody: 'Share playlists and help other people discover interesting content.',
    featureGuestTitle: 'Use it without signing in',
    featureGuestBody: 'Explore public content as a guest. Sign in only when you want personal and social features.',
    installEyebrow: 'Want an icon on your home screen?',
    installTitle: 'Install a shortcut in seconds.',
    installBody: 'Voxyl is a PWA. You can add it to your home screen and open it like an app without installing it from the App Store or Play Store.',
    androidTitle: 'Android · Chrome',
    androidStep1: 'Open v.renbrant.com in Chrome.',
    androidStep2: 'Tap the three-dot menu.',
    androidStep3: 'Choose “Add to Home screen” or “Install app”.',
    androidStep4: 'Confirm to create the Voxyl icon.',
    iosTitle: 'iPhone / iPad · Safari',
    iosStep1: 'Open v.renbrant.com in Safari.',
    iosStep2: 'Tap the Share button.',
    iosStep3: 'Choose “Add to Home Screen”.',
    iosStep4: 'Tap “Add”.',
    apkEyebrow: 'Prefer an Android installation?',
    apkTitle: 'Download the official Voxyl APK.',
    apkBody: 'During beta, the Android version can also be installed directly from the APK published on GitHub. Android may ask you to allow installs from external sources.',
    apkButton: 'Download APK v0.4.5',
    releasesButton: 'View GitHub releases',
    finalTitle: 'Ready to listen?',
    finalBody: 'Open Voxyl right now. No installation is required.',
    finalButton: 'Start listening',
    beta: 'Voxyl is in beta',
    footer: 'Voxyl · Social Podcast Playlists',
  },
};

const featureItems = [
  ['featureDiscoverTitle', 'featureDiscoverBody', Radio],
  ['featurePlaylistTitle', 'featurePlaylistBody', ListMusic],
  ['featurePeopleTitle', 'featurePeopleBody', Users],
  ['featureContinueTitle', 'featureContinueBody', Headphones],
  ['featureShareTitle', 'featureShareBody', Share2],
  ['featureGuestTitle', 'featureGuestBody', Sparkles],
];

function StepList({ items }) {
  return (
    <ol className="mt-5 space-y-3">
      {items.map((item, index) => (
        <li key={item} className="flex gap-3 text-sm leading-6 text-white/70">
          <span className="mt-0.5 flex h-6 w-6 flex-none items-center justify-center rounded-full bg-orange-500/15 text-xs font-semibold text-orange-400">
            {index + 1}
          </span>
          <span>{item}</span>
        </li>
      ))}
    </ol>
  );
}

export default function Landing() {
  const c = copy[lang] || copy.pt;

  return (
    <div className="min-h-screen overflow-x-hidden bg-[#0f0d0b] text-white">
      <div className="pointer-events-none fixed inset-x-0 top-0 h-[520px] bg-[radial-gradient(circle_at_50%_-10%,rgba(249,116,21,0.22),transparent_58%)]" />

      <header className="sticky top-0 z-50 border-b border-white/5 bg-[#0f0d0b]/85 backdrop-blur-xl">
        <div className="mx-auto flex h-16 max-w-7xl items-center justify-between px-4 sm:px-6 lg:px-8">
          <a href="#top" className="flex items-center gap-2.5" aria-label="Voxyl">
            <img
              src="/branding/voxyl-symbol-transparent.png"
              alt=""
              className="h-9 w-9 object-contain"
            />
            <span className="font-grotesk text-xl font-bold text-gradient">Voxyl</span>
          </a>

          <nav className="hidden items-center gap-7 text-sm text-white/60 md:flex">
            <a href="#how" className="transition hover:text-white">{c.navHow}</a>
            <a href="#features" className="transition hover:text-white">{c.navFeatures}</a>
            <a href="#install" className="transition hover:text-white">{c.navInstall}</a>
          </nav>

          <div className="flex items-center gap-2">
            <div className="hidden rounded-full border border-white/10 bg-white/5 p-1 sm:flex">
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
            <Link
              to="/app"
              className="inline-flex items-center gap-2 rounded-full bg-orange-500 px-4 py-2 text-sm font-semibold text-white shadow-lg shadow-orange-500/20 transition hover:bg-orange-400 active:scale-[0.98]"
            >
              <span className="hidden sm:inline">{c.openApp}</span>
              <Headphones className="h-4 w-4 sm:hidden" />
              <ArrowRight className="h-4 w-4" />
            </Link>
          </div>
        </div>
      </header>

      <main id="top" className="relative">
        <section className="mx-auto grid max-w-7xl gap-12 px-4 pb-20 pt-16 sm:px-6 sm:pt-24 lg:grid-cols-[1.1fr_0.9fr] lg:items-center lg:px-8 lg:pb-28 lg:pt-32">
          <div>
            <div className="mb-6 inline-flex items-center gap-2 rounded-full border border-orange-500/20 bg-orange-500/10 px-3 py-1.5 text-xs font-semibold uppercase tracking-[0.16em] text-orange-300">
              <Sparkles className="h-3.5 w-3.5" />
              {c.eyebrow}
            </div>

            <h1 className="max-w-4xl font-grotesk text-4xl font-bold leading-[1.06] tracking-[-0.03em] sm:text-6xl lg:text-7xl">
              {c.heroTitleA}{' '}
              <span className="text-gradient">{c.heroTitleB}</span>
            </h1>

            <p className="mt-6 max-w-2xl text-base leading-7 text-white/60 sm:text-lg">
              {c.heroBody}
            </p>

            <div className="mt-8 flex flex-col gap-3 sm:flex-row">
              <Link
                to="/app"
                className="inline-flex min-h-12 items-center justify-center gap-2 rounded-2xl bg-orange-500 px-6 py-3 font-semibold text-white shadow-xl shadow-orange-500/20 transition hover:-translate-y-0.5 hover:bg-orange-400"
              >
                <Headphones className="h-5 w-5" />
                {c.openApp}
                <ArrowRight className="h-4 w-4" />
              </Link>
              <a
                href="#install"
                className="inline-flex min-h-12 items-center justify-center gap-2 rounded-2xl border border-white/10 bg-white/5 px-6 py-3 font-semibold text-white/80 transition hover:bg-white/10 hover:text-white"
              >
                <Smartphone className="h-5 w-5" />
                {c.navInstall}
              </a>
            </div>

            <p className="mt-4 flex items-center gap-2 text-sm text-white/45">
              <Check className="h-4 w-4 text-orange-400" />
              {c.freeGuest}
            </p>
          </div>

          <div className="relative">
            <div className="absolute -inset-10 bg-[radial-gradient(circle,rgba(249,116,21,0.15),transparent_65%)] blur-2xl" />
            <div className="relative overflow-hidden rounded-[2rem] border border-white/10 bg-gradient-to-b from-white/[0.08] to-white/[0.03] p-6 shadow-2xl shadow-black/40 sm:p-8">
              <div className="mb-8 flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-orange-500/15">
                    <Globe2 className="h-5 w-5 text-orange-400" />
                  </div>
                  <div>
                    <p className="text-xs font-semibold uppercase tracking-[0.15em] text-orange-400">{c.browserBadge}</p>
                    <p className="mt-1 text-xs text-white/35">v.renbrant.com</p>
                  </div>
                </div>
                <span className="rounded-full border border-emerald-500/20 bg-emerald-500/10 px-2.5 py-1 text-[11px] font-semibold text-emerald-300">
                  WEB
                </span>
              </div>

              <h2 className="font-grotesk text-2xl font-semibold sm:text-3xl">{c.browserTitle}</h2>
              <p className="mt-4 leading-7 text-white/60">{c.browserBody}</p>

              <div className="mt-7 rounded-2xl border border-white/8 bg-black/20 p-4">
                <div className="flex items-center gap-3 text-sm text-white/70">
                  <Chrome className="h-5 w-5 text-orange-400" />
                  Chrome
                  <span className="text-white/20">·</span>
                  <Apple className="h-5 w-5 text-white/65" />
                  Safari
                  <span className="text-white/20">·</span>
                  Edge
                </div>
              </div>

              <Link
                to="/app"
                className="mt-5 inline-flex w-full items-center justify-center gap-2 rounded-2xl border border-orange-400/30 bg-orange-500/10 px-5 py-3.5 font-semibold text-orange-300 transition hover:bg-orange-500/15"
              >
                {c.browserCta}
                <ArrowRight className="h-4 w-4" />
              </Link>
            </div>
          </div>
        </section>

        <section id="how" className="border-y border-white/5 bg-white/[0.015]">
          <div className="mx-auto max-w-7xl px-4 py-20 sm:px-6 lg:px-8 lg:py-24">
            <div className="max-w-2xl">
              <p className="text-xs font-semibold uppercase tracking-[0.18em] text-orange-400">{c.sectionHowEyebrow}</p>
              <h2 className="mt-3 font-grotesk text-3xl font-bold tracking-tight sm:text-4xl">{c.sectionHowTitle}</h2>
              <p className="mt-4 leading-7 text-white/55">{c.sectionHowBody}</p>
            </div>

            <div className="mt-10 grid gap-4 md:grid-cols-3">
              {[
                [Globe2, c.optionBrowserTitle, c.optionBrowserBody],
                [Smartphone, c.optionShortcutTitle, c.optionShortcutBody],
                [Download, c.optionApkTitle, c.optionApkBody],
              ].map(([Icon, title, body]) => (
                <div key={title} className="rounded-3xl border border-white/8 bg-white/[0.035] p-6">
                  <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-orange-500/12 text-orange-400">
                    <Icon className="h-5 w-5" />
                  </div>
                  <h3 className="mt-5 font-grotesk text-xl font-semibold">{title}</h3>
                  <p className="mt-3 text-sm leading-6 text-white/55">{body}</p>
                </div>
              ))}
            </div>
          </div>
        </section>

        <section id="features" className="mx-auto max-w-7xl px-4 py-20 sm:px-6 lg:px-8 lg:py-28">
          <div className="max-w-2xl">
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-orange-400">{c.featuresEyebrow}</p>
            <h2 className="mt-3 font-grotesk text-3xl font-bold tracking-tight sm:text-4xl">{c.featuresTitle}</h2>
          </div>

          <div className="mt-10 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {featureItems.map(([titleKey, bodyKey, Icon]) => (
              <div key={titleKey} className="rounded-3xl border border-white/8 bg-gradient-to-b from-white/[0.05] to-white/[0.025] p-6">
                <Icon className="h-6 w-6 text-orange-400" />
                <h3 className="mt-5 font-grotesk text-lg font-semibold">{c[titleKey]}</h3>
                <p className="mt-2 text-sm leading-6 text-white/55">{c[bodyKey]}</p>
              </div>
            ))}
          </div>
        </section>

        <section id="install" className="border-y border-white/5 bg-white/[0.015]">
          <div className="mx-auto max-w-7xl px-4 py-20 sm:px-6 lg:px-8 lg:py-24">
            <div className="grid gap-12 lg:grid-cols-[0.8fr_1.2fr] lg:items-start">
              <div className="lg:sticky lg:top-28">
                <p className="text-xs font-semibold uppercase tracking-[0.18em] text-orange-400">{c.installEyebrow}</p>
                <h2 className="mt-3 font-grotesk text-3xl font-bold tracking-tight sm:text-4xl">{c.installTitle}</h2>
                <p className="mt-4 leading-7 text-white/55">{c.installBody}</p>
              </div>

              <div className="grid gap-4 md:grid-cols-2">
                <div className="rounded-3xl border border-white/8 bg-white/[0.035] p-6">
                  <div className="flex items-center gap-3">
                    <Chrome className="h-6 w-6 text-orange-400" />
                    <h3 className="font-grotesk text-lg font-semibold">{c.androidTitle}</h3>
                  </div>
                  <StepList items={[c.androidStep1, c.androidStep2, c.androidStep3, c.androidStep4]} />
                </div>

                <div className="rounded-3xl border border-white/8 bg-white/[0.035] p-6">
                  <div className="flex items-center gap-3">
                    <Apple className="h-6 w-6 text-orange-400" />
                    <h3 className="font-grotesk text-lg font-semibold">{c.iosTitle}</h3>
                  </div>
                  <StepList items={[c.iosStep1, c.iosStep2, c.iosStep3, c.iosStep4]} />
                </div>
              </div>
            </div>
          </div>
        </section>

        <section className="mx-auto max-w-7xl px-4 py-20 sm:px-6 lg:px-8 lg:py-24">
          <div className="overflow-hidden rounded-[2rem] border border-orange-500/20 bg-gradient-to-br from-orange-500/12 via-white/[0.03] to-white/[0.02] p-7 sm:p-10">
            <div className="grid gap-8 lg:grid-cols-[1fr_auto] lg:items-center">
              <div>
                <p className="text-xs font-semibold uppercase tracking-[0.18em] text-orange-400">{c.apkEyebrow}</p>
                <h2 className="mt-3 font-grotesk text-3xl font-bold">{c.apkTitle}</h2>
                <p className="mt-4 max-w-3xl leading-7 text-white/55">{c.apkBody}</p>
                <p className="mt-4 text-sm font-medium text-white/45">{c.currentBeta}</p>
              </div>
              <div className="flex flex-col gap-3 sm:flex-row lg:flex-col">
                <a
                  href={APK_DOWNLOAD_URL}
                  className="inline-flex min-h-12 items-center justify-center gap-2 rounded-2xl bg-orange-500 px-5 py-3 font-semibold text-white transition hover:bg-orange-400"
                >
                  <Download className="h-5 w-5" />
                  {c.apkButton}
                </a>
                <a
                  href={RELEASES_URL}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex min-h-12 items-center justify-center rounded-2xl border border-white/10 bg-white/5 px-5 py-3 text-sm font-semibold text-white/70 transition hover:bg-white/10 hover:text-white"
                >
                  {c.releasesButton}
                </a>
              </div>
            </div>
          </div>
        </section>

        <section className="mx-auto max-w-4xl px-4 pb-24 pt-6 text-center sm:px-6 lg:pb-32">
          <img
            src="/branding/voxyl-symbol-transparent.png"
            alt=""
            className="mx-auto h-16 w-16 object-contain"
          />
          <h2 className="mt-6 font-grotesk text-3xl font-bold sm:text-4xl">{c.finalTitle}</h2>
          <p className="mt-3 text-white/55">{c.finalBody}</p>
          <Link
            to="/app"
            className="mt-7 inline-flex min-h-12 items-center justify-center gap-2 rounded-2xl bg-orange-500 px-7 py-3 font-semibold text-white shadow-xl shadow-orange-500/20 transition hover:-translate-y-0.5 hover:bg-orange-400"
          >
            <Headphones className="h-5 w-5" />
            {c.finalButton}
            <ArrowRight className="h-4 w-4" />
          </Link>
        </section>
      </main>

      <footer className="border-t border-white/5">
        <div className="mx-auto flex max-w-7xl flex-col gap-4 px-4 py-7 text-xs text-white/35 sm:flex-row sm:items-center sm:justify-between sm:px-6 lg:px-8">
          <div>
            <p>{c.footer}</p>
            <p className="mt-1">{c.beta}</p>
          </div>
          <div className="flex gap-5">
            <a href="/privacy" className="transition hover:text-white/70">Privacy</a>
            <a href="https://github.com/Renbrant/Voxyl-APP" target="_blank" rel="noreferrer" className="transition hover:text-white/70">
              GitHub
            </a>
          </div>
        </div>
      </footer>
    </div>
  );
}
