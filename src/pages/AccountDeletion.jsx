import { useState } from 'react';
import { ArrowLeft, LogIn, ShieldAlert, Trash2 } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { AnimatePresence } from 'framer-motion';
import PageTransition from '@/components/common/PageTransition';
import DeleteAccountModal from '@/components/profile/DeleteAccountModal';
import { useAuth } from '@/lib/AuthContext';
import { lang } from '@/lib/i18n';
import supportContact from '@/data/support-contact.json';

const SUPPORT_EMAIL = supportContact.supportEmail;

export default function AccountDeletion() {
  const navigate = useNavigate();
  const {
    user,
    isAuthenticated,
    navigateToLogin,
  } = useAuth();

  const [showDelete, setShowDelete] = useState(false);

  const isPt = lang === 'pt';

  const labels = isPt
    ? {
        title: 'Exclusão de conta',
        eyebrow: 'Voxyl · Solicitação pública de exclusão',
        intro:
          'Você pode solicitar a exclusão permanente da sua conta do Voxyl e dos dados pessoais associados a ela.',
        removesTitle: 'O que será excluído',
        removes: [
          'Sua conta e identidade de acesso ao Voxyl.',
          'Playlists criadas por você.',
          'Curtidas e conteúdo salvo.',
          'Histórico de reprodução e progresso de episódios.',
          'Relacionamentos sociais, bloqueios e referências vinculadas à sua conta.',
          'Mídia de perfil armazenada pelo Voxyl.',
        ],
        warning:
          'A exclusão é permanente e não pode ser desfeita.',
        signedInTitle: 'Excluir diretamente pelo Voxyl',
        signedInBody:
          'Você está autenticado. Use o botão abaixo para abrir o fluxo de confirmação em três etapas.',
        deleteButton: 'Excluir minha conta',
        signedOutTitle: 'Entre para excluir diretamente',
        signedOutBody:
          'Para confirmar sua identidade e excluir a conta diretamente, entre no Voxyl e volte para esta página.',
        signInButton: 'Entrar no Voxyl',
        fallbackTitle: 'Não consegue entrar?',
        fallbackBody:
          'Você também pode solicitar a exclusão pelo e-mail oficial de suporte. Inclua o endereço de e-mail usado na sua conta para que possamos localizar e verificar a solicitação.',
        emailButton: 'Solicitar exclusão por e-mail',
        privacy: 'Ver Política de Privacidade',
        back: 'Voltar',
      }
    : {
        title: 'Account deletion',
        eyebrow: 'Voxyl · Public deletion request',
        intro:
          'You can request permanent deletion of your Voxyl account and the personal data associated with it.',
        removesTitle: 'What will be deleted',
        removes: [
          'Your Voxyl account and sign-in identity.',
          'Playlists you created.',
          'Likes and saved content.',
          'Listening history and episode progress.',
          'Social relationships, blocks, and referrals linked to your account.',
          'Profile media stored by Voxyl.',
        ],
        warning:
          'Deletion is permanent and cannot be undone.',
        signedInTitle: 'Delete directly through Voxyl',
        signedInBody:
          'You are signed in. Use the button below to open the three-step confirmation flow.',
        deleteButton: 'Delete my account',
        signedOutTitle: 'Sign in to delete directly',
        signedOutBody:
          'To verify your identity and delete the account directly, sign in to Voxyl and return to this page.',
        signInButton: 'Sign in to Voxyl',
        fallbackTitle: 'Cannot sign in?',
        fallbackBody:
          'You can also request deletion through the official support email. Include the email address used for your account so we can locate and verify the request.',
        emailButton: 'Request deletion by email',
        privacy: 'View Privacy Policy',
        back: 'Back',
      };

  const handleBack = () => {
    if (window.history.length > 1) {
      navigate(-1);
      return;
    }

    navigate('/');
  };

  const deletionSubject = isPt
    ? 'Solicitação de exclusão de conta Voxyl'
    : 'Voxyl account deletion request';

  const mailtoUrl =
    `mailto:${SUPPORT_EMAIL}?subject=${encodeURIComponent(deletionSubject)}`;

  return (
    <PageTransition>
      <div className="min-h-screen bg-background">
        <header
          className="sticky top-0 z-10 glass border-b border-border px-4 py-4 flex items-center gap-3"
          style={{ paddingTop: 'calc(env(safe-area-inset-top, 0px) + 1rem)' }}
        >
          <button
            type="button"
            onClick={handleBack}
            className="w-8 h-8 rounded-full bg-secondary flex items-center justify-center"
            aria-label={labels.back}
          >
            <ArrowLeft size={16} />
          </button>

          <h1 className="font-grotesk font-bold text-base">
            {labels.title}
          </h1>
        </header>

        <main className="px-5 py-6 max-w-3xl mx-auto pb-16">
          <section className="rounded-2xl border border-primary/20 bg-primary/5 p-5">
            <div className="flex items-start gap-3">
              <ShieldAlert
                size={22}
                className="text-primary mt-0.5 flex-shrink-0"
              />

              <div>
                <p className="text-sm font-semibold text-foreground">
                  {labels.eyebrow}
                </p>
                <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
                  {labels.intro}
                </p>
              </div>
            </div>
          </section>

          <section className="mt-8">
            <h2 className="font-grotesk font-semibold text-base text-foreground mb-3">
              {labels.removesTitle}
            </h2>

            <ul className="space-y-2">
              {labels.removes.map((item) => (
                <li
                  key={item}
                  className="text-sm text-muted-foreground leading-relaxed flex gap-2"
                >
                  <span
                    className="text-primary mt-1 flex-shrink-0"
                    aria-hidden="true"
                  >
                    •
                  </span>
                  <span>{item}</span>
                </li>
              ))}
            </ul>

            <div className="mt-4 rounded-xl border border-destructive/25 bg-destructive/5 px-4 py-3">
              <p className="text-sm text-foreground">
                {labels.warning}
              </p>
            </div>
          </section>

          {isAuthenticated && user ? (
            <section className="mt-8 rounded-2xl border border-border bg-secondary/40 p-5">
              <h2 className="font-grotesk font-semibold text-base text-foreground">
                {labels.signedInTitle}
              </h2>

              <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
                {labels.signedInBody}
              </p>

              <button
                type="button"
                onClick={() => setShowDelete(true)}
                className="mt-5 w-full min-h-12 rounded-xl bg-destructive px-4 py-3 text-sm font-semibold text-destructive-foreground flex items-center justify-center gap-2"
              >
                <Trash2 size={17} />
                {labels.deleteButton}
              </button>
            </section>
          ) : (
            <section className="mt-8 rounded-2xl border border-border bg-secondary/40 p-5">
              <h2 className="font-grotesk font-semibold text-base text-foreground">
                {labels.signedOutTitle}
              </h2>

              <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
                {labels.signedOutBody}
              </p>

              <button
                type="button"
                onClick={navigateToLogin}
                className="mt-5 w-full min-h-12 rounded-xl bg-primary px-4 py-3 text-sm font-semibold text-primary-foreground flex items-center justify-center gap-2"
              >
                <LogIn size={17} />
                {labels.signInButton}
              </button>
            </section>
          )}

          <section className="mt-6 rounded-2xl border border-border p-5">
            <h2 className="font-grotesk font-semibold text-base text-foreground">
              {labels.fallbackTitle}
            </h2>

            <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
              {labels.fallbackBody}
            </p>

            <a
              href={mailtoUrl}
              className="mt-4 inline-flex min-h-11 items-center text-sm font-semibold text-primary underline underline-offset-4 break-all"
            >
              {labels.emailButton}: {SUPPORT_EMAIL}
            </a>
          </section>

          <div className="mt-8 pt-6 border-t border-border">
            <button
              type="button"
              onClick={() => navigate('/privacy')}
              className="text-sm text-primary underline underline-offset-4"
            >
              {labels.privacy}
            </button>
          </div>
        </main>

        <AnimatePresence>
          {showDelete && user && (
            <DeleteAccountModal
              user={user}
              onClose={() => setShowDelete(false)}
            />
          )}
        </AnimatePresence>
      </div>
    </PageTransition>
  );
}
