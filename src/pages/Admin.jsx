import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import {
  Activity,
  AlertTriangle,
  ArrowLeft,
  BarChart3,
  CheckCircle2,
  Database,
  Flame,
  Heart,
  ListMusic,
  Play,
  RefreshCw,
  ShieldAlert,
  ShieldCheck,
  TrendingUp,
  Users,
} from 'lucide-react';
import {
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { voxylApi } from '@/api/voxylApiClient';
import { useAuth } from '@/lib/AuthContext';
import UserAvatar from '@/components/common/UserAvatar';

export default function Admin() {
  const navigate = useNavigate();
  const { apiUser, user, isLoadingAuth } = useAuth();
  const [activeTab, setActiveTab] = useState('overview');

  const currentUser = apiUser || user;
  const isAdmin =
    currentUser?.role === 'admin' ||
    currentUser?.email?.toLowerCase() === 'renatobrant@gmail.com';

  const { data, isLoading, error, refetch, isFetching } = useQuery({
    queryKey: ['admin-metrics'],
    queryFn: () => voxylApi.admin.metrics({ fresh: true }),
    enabled: Boolean(isAdmin),
    refetchInterval: 60000,
  });

  if (isLoadingAuth) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <div className="w-8 h-8 border-2 border-primary border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  if (!isAdmin) {
    return (
      <div className="min-h-screen bg-background flex flex-col items-center justify-center px-4 text-center">
        <div className="w-16 h-16 rounded-2xl bg-destructive/10 border border-destructive/30 flex items-center justify-center mb-4 text-destructive">
          <ShieldAlert size={32} />
        </div>
        <h1 className="text-xl font-bold font-grotesk text-foreground mb-2">Acesso Restrito</h1>
        <p className="text-sm text-muted-foreground max-w-sm mb-6">
          Esta página é restrita a administradores do Voxyl. Sua conta atual não possui privilégios de acesso.
        </p>
        <button
          type="button"
          onClick={() => navigate('/app')}
          className="px-5 py-2.5 rounded-full bg-primary text-white font-medium text-sm hover:opacity-90 transition-opacity"
        >
          Voltar para o App
        </button>
      </div>
    );
  }

  const stats = data?.stats || {};
  const cf = data?.cloudflare || {};
  const isConfigured = Boolean(cf?.configured);
  const cfLimits = cf?.limits || { d1Writes: 100000, d1Reads: 5000000, workerRequests: 100000 };

  const d1Writes = cf?.rowsWritten || 0;
  const d1WritesPct = cf?.rowsWrittenPct ?? (isConfigured ? Number(((d1Writes / cfLimits.d1Writes) * 100).toFixed(1)) : 0);
  const d1Reads = cf?.rowsRead || 0;
  const d1ReadsPct = isConfigured ? Number(((d1Reads / cfLimits.d1Reads) * 100).toFixed(1)) : 0;

  let healthBadge = { label: 'Saúde Normal', color: 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20' };
  if (!isConfigured) {
    healthBadge = { label: 'Aguardando API Token', color: 'bg-amber-500/10 text-amber-400 border-amber-500/20' };
  } else if (d1WritesPct >= 100) {
    healthBadge = { label: `Cota Excedida (${d1WritesPct}%)`, color: 'bg-red-500/10 text-red-400 border-red-500/20' };
  } else if (d1WritesPct >= 80) {
    healthBadge = { label: `Risco de Cota (${d1WritesPct}%)`, color: 'bg-red-500/10 text-red-400 border-red-500/20' };
  } else if (d1WritesPct >= 50) {
    healthBadge = { label: `Atenção (${d1WritesPct}%)`, color: 'bg-amber-500/10 text-amber-400 border-amber-500/20' };
  }

  return (
    <div className="min-h-screen bg-background pb-28">
      {/* Header */}
      <div
        className="px-4 pb-4 border-b border-border/50 sticky top-0 bg-background/95 backdrop-blur z-20"
        style={{ paddingTop: 'calc(env(safe-area-inset-top, 0px) + 1.25rem)' }}
      >
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={() => navigate(-1)}
              className="p-2 rounded-xl bg-card border border-border hover:bg-secondary transition-colors"
            >
              <ArrowLeft size={18} className="text-foreground" />
            </button>
            <div>
              <div className="flex items-center gap-2">
                <h1 className="text-xl font-bold font-grotesk text-foreground">Painel de Administração</h1>
                <span className="px-2 py-0.5 text-[10px] font-bold uppercase rounded-md bg-primary/20 text-primary border border-primary/30">
                  Admin
                </span>
              </div>
              <p className="text-xs text-muted-foreground">Monitoramento de Cotas e Métricas do Sistema</p>
            </div>
          </div>
          <button
            type="button"
            onClick={() => refetch()}
            disabled={isFetching}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl border border-border bg-card hover:bg-secondary text-xs text-foreground font-medium transition-colors disabled:opacity-50"
          >
            <RefreshCw size={13} className={isFetching ? 'animate-spin text-primary' : ''} />
            <span className="hidden sm:inline">Atualizar</span>
          </button>
        </div>
      </div>

      <div className="max-w-5xl mx-auto px-4 pt-6 space-y-6">
        {/* Banner de Status de Cotas Cloudflare */}
        <div className="rounded-2xl border border-border bg-card p-5 shadow-sm">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-4">
            <div className="flex items-center gap-2.5">
              <div className="w-9 h-9 rounded-xl bg-orange-500/10 border border-orange-500/20 flex items-center justify-center text-primary">
                <Flame size={18} />
              </div>
              <div>
                <h2 className="text-sm font-semibold text-foreground">Cotas Diárias Cloudflare (Free Tier)</h2>
                <p className="text-xs text-muted-foreground">
                  Monitoramento de limites diários para prevenção de indisponibilidade
                </p>
              </div>
            </div>
            <div className={`self-start sm:self-auto px-2.5 py-1 rounded-full text-xs font-semibold border ${healthBadge.color} flex items-center gap-1.5`}>
              <CheckCircle2 size={13} />
              <span>{healthBadge.label}</span>
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-4 pt-2">
            {/* D1 Row Writes */}
            <div className="rounded-xl border border-border/80 bg-background/60 p-4">
              <div className="flex items-center justify-between mb-2">
                <span className="text-xs font-medium text-muted-foreground flex items-center gap-1.5">
                  <Database size={13} className="text-primary" /> D1 Row Writes
                </span>
                <span className={`text-xs font-bold ${!isConfigured ? 'text-amber-400' : d1WritesPct >= 100 ? 'text-red-400' : 'text-foreground'}`}>
                  {isConfigured ? `${d1WritesPct}%` : 'Pendente Token'}
                </span>
              </div>
              <div className="w-full bg-secondary h-2 rounded-full overflow-hidden mb-2">
                <div
                  className={`h-full rounded-full transition-all ${
                    !isConfigured ? 'bg-muted-foreground/30' : d1WritesPct >= 80 ? 'bg-red-500' : d1WritesPct >= 50 ? 'bg-amber-500' : 'bg-emerald-500'
                  }`}
                  style={{ width: `${Math.min(isConfigured ? d1WritesPct : 0, 100)}%` }}
                />
              </div>
              <div className="flex items-baseline justify-between text-xs">
                <span className="font-semibold text-foreground">
                  {isConfigured ? d1Writes.toLocaleString('pt-BR') : '-'}
                </span>
                <span className="text-muted-foreground">de 100.000 / dia</span>
              </div>
            </div>

            {/* D1 Row Reads */}
            <div className="rounded-xl border border-border/80 bg-background/60 p-4">
              <div className="flex items-center justify-between mb-2">
                <span className="text-xs font-medium text-muted-foreground flex items-center gap-1.5">
                  <Database size={13} className="text-sky-400" /> D1 Row Reads
                </span>
                <span className={`text-xs font-bold ${!isConfigured ? 'text-amber-400' : 'text-foreground'}`}>
                  {isConfigured ? `${d1ReadsPct}%` : 'Pendente Token'}
                </span>
              </div>
              <div className="w-full bg-secondary h-2 rounded-full overflow-hidden mb-2">
                <div
                  className="h-full bg-sky-500 rounded-full transition-all"
                  style={{ width: `${Math.min(isConfigured ? d1ReadsPct : 0, 100)}%` }}
                />
              </div>
              <div className="flex items-baseline justify-between text-xs">
                <span className="font-semibold text-foreground">
                  {isConfigured ? d1Reads.toLocaleString('pt-BR') : '-'}
                </span>
                <span className="text-muted-foreground">de 5.000.000 / dia</span>
              </div>
            </div>

            {/* Workers Requests */}
            <div className="rounded-xl border border-border/80 bg-background/60 p-4">
              <div className="flex items-center justify-between mb-2">
                <span className="text-xs font-medium text-muted-foreground flex items-center gap-1.5">
                  <Activity size={13} className="text-violet-400" /> Worker Requests
                </span>
                <span className="text-xs font-bold text-foreground">
                  {isConfigured && cf?.queryCount ? `${((cf.queryCount / cfLimits.workerRequests) * 100).toFixed(1)}%` : 'Ativo'}
                </span>
              </div>
              <div className="w-full bg-secondary h-2 rounded-full overflow-hidden mb-2">
                <div
                  className="h-full bg-violet-500 rounded-full transition-all"
                  style={{ width: `${Math.min(isConfigured ? (((cf?.queryCount || 0) / cfLimits.workerRequests) * 100) : 10, 100)}%` }}
                />
              </div>
              <div className="flex items-baseline justify-between text-xs">
                <span className="font-semibold text-foreground">
                  {isConfigured ? (cf?.queryCount || 0).toLocaleString('pt-BR') : '-'}
                </span>
                <span className="text-muted-foreground">de 100.000 / dia</span>
              </div>
            </div>
          </div>

          {cf?.notice && (
            <div className="mt-4 p-3 rounded-xl bg-amber-500/10 border border-amber-500/20 text-xs text-amber-200 flex items-start gap-2.5">
              <AlertTriangle size={15} className="mt-0.5 flex-shrink-0 text-amber-400" />
              <div>
                <p className="font-semibold text-amber-300">Aviso de Telemetria Cloudflare:</p>
                <p className="mt-0.5 text-amber-200/90 leading-relaxed">{cf.notice}</p>
              </div>
            </div>
          )}

          {!isConfigured && !cf?.notice && (
            <div className="mt-4 pt-3 border-t border-border/60 flex items-start gap-2.5 text-xs text-muted-foreground">
              <ShieldCheck size={14} className="text-primary mt-0.5 flex-shrink-0" />
              <span>
                <strong>Modo Somente-Leitura Ativo</strong>: As escritas repetidas no D1 durante a sincronização de conta foram eliminadas no release 0.4.6.
                Para telemetria direta via API da Cloudflare, adicione o segredo <code className="text-primary">CLOUDFLARE_API_TOKEN</code> no Worker via <code className="text-primary">npx wrangler secret put CLOUDFLARE_API_TOKEN</code>.
              </span>
            </div>
          )}
        </div>


        {/* KPIs de Usuários e Conteúdo */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          <div className="rounded-2xl border border-border bg-card p-4">
            <div className="flex items-center gap-2.5 text-muted-foreground mb-2">
              <Users size={16} className="text-primary" />
              <span className="text-xs font-semibold uppercase tracking-wider">Usuários</span>
            </div>
            <div className="text-2xl font-bold font-grotesk text-foreground">
              {isLoading ? '...' : (stats?.users?.total || 0).toLocaleString()}
            </div>
            <p className="text-xs text-emerald-400 mt-1 flex items-center gap-1 font-medium">
              <TrendingUp size={12} /> +{stats?.users?.new7d || 0} últimos 7 dias
            </p>
          </div>

          <div className="rounded-2xl border border-border bg-card p-4">
            <div className="flex items-center gap-2.5 text-muted-foreground mb-2">
              <ListMusic size={16} className="text-sky-400" />
              <span className="text-xs font-semibold uppercase tracking-wider">Playlists</span>
            </div>
            <div className="text-2xl font-bold font-grotesk text-foreground">
              {isLoading ? '...' : (stats?.playlists?.total || 0).toLocaleString()}
            </div>
            <p className="text-xs text-muted-foreground mt-1">
              {stats?.playlists?.public || 0} públicas · {stats?.playlists?.private || 0} privadas
            </p>
          </div>

          <div className="rounded-2xl border border-border bg-card p-4">
            <div className="flex items-center gap-2.5 text-muted-foreground mb-2">
              <Play size={16} className="text-amber-400" />
              <span className="text-xs font-semibold uppercase tracking-wider">Reproduções</span>
            </div>
            <div className="text-2xl font-bold font-grotesk text-foreground">
              {isLoading ? '...' : (stats?.engagement?.totalPlays || 0).toLocaleString()}
            </div>
            <p className="text-xs text-amber-400 mt-1 font-medium">
              +{stats?.engagement?.plays7d || 0} últimos 7 dias
            </p>
          </div>

          <div className="rounded-2xl border border-border bg-card p-4">
            <div className="flex items-center gap-2.5 text-muted-foreground mb-2">
              <Heart size={16} className="text-rose-400" />
              <span className="text-xs font-semibold uppercase tracking-wider">Curtidas</span>
            </div>
            <div className="text-2xl font-bold font-grotesk text-foreground">
              {isLoading ? '...' : ((stats?.engagement?.playlistLikes || 0) + (stats?.engagement?.podcastLikes || 0)).toLocaleString()}
            </div>
            <p className="text-xs text-muted-foreground mt-1">
              {stats?.engagement?.playlistLikes || 0} em playlists · {stats?.engagement?.podcastLikes || 0} em podcasts
            </p>
          </div>
        </div>

        {/* Gráficos de Atividade dos últimos 7 dias */}
        <div className="rounded-2xl border border-border bg-card p-5">
          <div className="flex items-center justify-between mb-4">
            <div>
              <h3 className="text-sm font-semibold text-foreground flex items-center gap-2">
                <BarChart3 size={16} className="text-primary" />
                Atividade de Reproduções (Últimos 7 dias)
              </h3>
              <p className="text-xs text-muted-foreground">Volume diário de episódios reproduzidos pelos ouvintes</p>
            </div>
          </div>

          <div className="h-48 w-full">
            {stats?.charts?.dailyPlays?.length > 0 ? (
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={stats.charts.dailyPlays}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#262626" vertical={false} />
                  <XAxis dataKey="day" stroke="#737373" fontSize={11} tickLine={false} />
                  <YAxis stroke="#737373" fontSize={11} tickLine={false} axisLine={false} />
                  <Tooltip
                    contentStyle={{ backgroundColor: '#171717', borderColor: '#404040', borderRadius: '8px', color: '#fff', fontSize: '12px' }}
                    labelStyle={{ color: '#F97415', fontWeight: 'bold' }}
                  />
                  <Bar dataKey="count" fill="#F97415" radius={[4, 4, 0, 0]} name="Reproduções" />
                </BarChart>
              </ResponsiveContainer>
            ) : (
              <div className="h-full flex items-center justify-center text-xs text-muted-foreground">
                Sem eventos de reprodução registrados nos últimos 7 dias.
              </div>
            )}
          </div>
        </div>

        {/* Seção com Tabelas de Atividade Recente */}
        <div className="rounded-2xl border border-border bg-card p-5">
          <div className="flex items-center justify-between border-b border-border pb-3 mb-4">
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => setActiveTab('users')}
                className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors ${
                  activeTab === 'users' || activeTab === 'overview'
                    ? 'bg-primary text-white'
                    : 'text-muted-foreground hover:text-foreground'
                }`}
              >
                Últimos Usuários ({stats?.recentUsers?.length || 0})
              </button>
              <button
                type="button"
                onClick={() => setActiveTab('playlists')}
                className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors ${
                  activeTab === 'playlists'
                    ? 'bg-primary text-white'
                    : 'text-muted-foreground hover:text-foreground'
                }`}
              >
                Últimas Playlists ({stats?.recentPlaylists?.length || 0})
              </button>
            </div>
          </div>

          {(activeTab === 'users' || activeTab === 'overview') && (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead>
                  <tr className="border-b border-border/60 text-muted-foreground font-semibold">
                    <th className="pb-2">Usuário</th>
                    <th className="pb-2">Username</th>
                    <th className="pb-2">E-mail</th>
                    <th className="pb-2">Função</th>
                    <th className="pb-2 text-right">Cadastrado em</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border/40">
                  {(stats?.recentUsers || []).map((u) => (
                    <tr key={u.id} className="hover:bg-secondary/40 transition-colors">
                      <td className="py-2.5 flex items-center gap-2">
                        <UserAvatar
                          src={u.profile_picture}
                          name={u.name}
                          username={u.username}
                          className="w-7 h-7"
                        />
                        <span className="font-medium text-foreground">{u.name || 'Sem nome'}</span>
                      </td>
                      <td className="py-2.5 text-muted-foreground">
                        {u.username ? `@${u.username}` : '-'}
                      </td>
                      <td className="py-2.5 text-muted-foreground">{u.email || '-'}</td>
                      <td className="py-2.5">
                        <span
                          className={`px-2 py-0.5 rounded text-[10px] font-bold uppercase ${
                            u.role === 'admin'
                              ? 'bg-primary/20 text-primary border border-primary/30'
                              : 'bg-secondary text-muted-foreground'
                          }`}
                        >
                          {u.role || 'user'}
                        </span>
                      </td>
                      <td className="py-2.5 text-right text-muted-foreground">
                        {u.created_at ? new Date(u.created_at).toLocaleDateString('pt-BR') : '-'}
                      </td>
                    </tr>
                  ))}
                  {(stats?.recentUsers || []).length === 0 && (
                    <tr>
                      <td colSpan={5} className="py-4 text-center text-muted-foreground">
                        Nenhum usuário recente encontrado.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          )}

          {activeTab === 'playlists' && (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead>
                  <tr className="border-b border-border/60 text-muted-foreground font-semibold">
                    <th className="pb-2">Título</th>
                    <th className="pb-2">Criador</th>
                    <th className="pb-2">Visibilidade</th>
                    <th className="pb-2 text-center">Curtidas</th>
                    <th className="pb-2 text-center">Plays</th>
                    <th className="pb-2 text-right">Data</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border/40">
                  {(stats?.recentPlaylists || []).map((p) => (
                    <tr key={p.id} className="hover:bg-secondary/40 transition-colors">
                      <td className="py-2.5 font-medium text-foreground">{p.title}</td>
                      <td className="py-2.5 text-muted-foreground">
                        {p.creator_username ? `@${p.creator_username}` : '-'}
                      </td>
                      <td className="py-2.5">
                        <span className="px-2 py-0.5 rounded text-[10px] uppercase font-semibold bg-secondary text-muted-foreground">
                          {p.visibility}
                        </span>
                      </td>
                      <td className="py-2.5 text-center text-muted-foreground">{p.likes_count || 0}</td>
                      <td className="py-2.5 text-center text-muted-foreground">{p.plays_count || 0}</td>
                      <td className="py-2.5 text-right text-muted-foreground">
                        {p.created_at ? new Date(p.created_at).toLocaleDateString('pt-BR') : '-'}
                      </td>
                    </tr>
                  ))}
                  {(stats?.recentPlaylists || []).length === 0 && (
                    <tr>
                      <td colSpan={6} className="py-4 text-center text-muted-foreground">
                        Nenhuma playlist recente encontrada.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
