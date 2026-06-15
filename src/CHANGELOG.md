# Changelog — Voxyl

## v2.5 — Junho 2026

### Melhorias

#### Interface responsiva para desktop e tablet
- Em telas médias e grandes (≥ 768px), a navegação inferior dá lugar a uma barra lateral fixa com logo e menu
- O conteúdo agora aproveita a largura disponível, com grades de 3 a 4 colunas em vez da largura fixa de celular
- Os destaques (hero) ficam maiores em telas grandes e o mini-player flutua no canto inferior direito
- A versão mobile permanece exatamente como estava

---

## v2.4.1 — Junho 2026

### Correções

#### Metadados de podcast incorretos
- Corrigido bug onde, ao abrir um podcast recém-buscado, o nome, autor e foto exibidos eram de outro podcast (os episódios apareciam corretos)
- Causa raiz: a chave de cache de feeds era gerada truncando o base64 da URL em 40 caracteres, fazendo URLs distintas colidirem na mesma chave
- Nova chave de cache usa hash djb2 + comprimento da URL, garantindo unicidade por feed

---

## v2.4.0 — Junho 2026

### Estabilidade e correções

#### Persistência de sessão no Android
- Corrigido bug crítico onde o app deslogava o usuário ao sair e voltar para o app
- Adicionado listener de `appStateChange` do Capacitor para re-hidratar o token ao retornar ao foreground
- `localStorage` agora é restaurado a partir do `Capacitor Preferences` (persistente) quando o Android destrói o WebView em background
- Token injetado explicitamente no SDK via `base44.auth.setToken()` ao retomar sessão

#### Callback OAuth nativo
- Fluxo de login Google via esquema customizado `com.renbrant.voxyl://auth/callback` estabilizado
- Detecção de callback nativo movida para `main.jsx` para execução antes da montagem do React

---

## v0.2 — Abril 2026

### Melhorias e correções

#### Acesso de convidados (Guest Mode)
- Usuários não autenticados podem navegar o Feed e explorar conteúdo sem fazer login
- Ações protegidas (curtir, seguir, criar playlists) redirecionam para login ao serem acionadas
- Páginas de Playlists e Perfil exibem tela de convite ao login quando não autenticado
- Botão "Entrar" aparece na barra de navegação inferior para usuários não logados

#### Compatibilidade Android / Google Play
- Corrigido erro 403 (Forbidden) durante login com Google em WebViews Android
- O login agora abre no navegador externo do sistema (Chrome), contornando restrições de OAuth em WebViews
- Utilitário centralizado `authRedirect` substitui chamadas diretas ao SDK em todos os pontos de redirecionamento

#### Técnico
- Refatoração do hook `useRequireAuth` para usar o utilitário `authRedirect`
- Remoção de imports duplicados do SDK em componentes de autenticação
- Melhoria na detecção de estado de carregamento (`isAuthed === null`) para evitar flickering de UI

---

## v0.1 — Abril 2026

### Lançamento inicial

#### Funcionalidades principais
- Feed principal com playlists em alta e recentes
- Seção "Podcasts em Alta" com ranking por reproduções
- Criação e edição de playlists com até 5 feeds RSS
- Player de áudio persistente com controles de reprodução
- Autoplay automático entre episódios
- Progresso de episódios salvo localmente e na nuvem
- Marcar episódios como concluídos (swipe ou pressão longa)

#### Social
- Seguir e ser seguido por outros usuários
- Aprovação de seguidores (modo privado)
- Curtir playlists
- Compartilhar playlists via link público (`/share/:id`)
- Bloquear e denunciar usuários ou conteúdo

#### Explorar
- Busca de podcasts via Podcast Index API
- Busca de usuários da plataforma
- Adicionar podcast diretamente a uma playlist existente ou nova

#### Perfil
- Página de perfil público com playlists e contagem de seguidores
- Username público personalizável
- Foto de perfil e configurações de conta
- Exclusão de conta

#### Playlists
- Visibilidade: pública, apenas seguidores, privada
- Filtro por duração máxima de episódio
- Filtro por data de publicação (últimas 24h, semana, mês, etc.)
- Ordem dos episódios: mais recentes ou mais antigos
- Capa personalizada (upload de imagem)
- Pular início/fim de cada feed (corte de vinheta)
- Reordenação de feeds por drag-and-drop

#### Técnico
- PWA com suporte offline parcial
- Cache de feeds RSS em localStorage e nuvem
- Política de Privacidade com declaração de permissões Android
- Suporte a tema escuro / claro / automático