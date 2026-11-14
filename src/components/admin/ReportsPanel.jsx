import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { voxylApi } from '@/api/voxylApiClient';

const REASON_LABELS = {
  inappropriate: 'Conteúdo inapropriado',
  spam: 'Spam',
  hate_speech: 'Discurso de ódio',
  misinformation: 'Desinformação',
  other: 'Outro',
};

const STATUS_FILTERS = [
  { value: 'open', label: 'Abertas' },
  { value: 'resolved', label: 'Resolvidas' },
  { value: 'dismissed', label: 'Descartadas' },
];

export const reportsQueryKey = (status) => ['admin-reports', status];

export default function ReportsPanel({ enabled }) {
  const queryClient = useQueryClient();
  const [status, setStatus] = useState('open');

  const { data: reports = [], isLoading, error, refetch } = useQuery({
    queryKey: reportsQueryKey(status),
    queryFn: () => voxylApi.admin.reports(status),
    enabled: Boolean(enabled),
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, nextStatus }) => voxylApi.admin.updateReport(id, nextStatus),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['admin-reports'] }),
  });

  return (
    <div>
      <div className="flex items-center gap-2 mb-3">
        {STATUS_FILTERS.map((filter) => (
          <button
            key={filter.value}
            type="button"
            onClick={() => setStatus(filter.value)}
            className={`px-2.5 py-1 rounded-lg text-[11px] font-semibold transition-colors ${
              status === filter.value ? 'bg-secondary text-foreground' : 'text-muted-foreground hover:text-foreground'
            }`}
          >
            {filter.label}
          </button>
        ))}
      </div>

      {isLoading && <p className="py-4 text-center text-xs text-muted-foreground">Carregando denúncias...</p>}

      {error && (
        <p role="alert" className="py-4 text-center text-xs text-destructive">
          Não foi possível carregar as denúncias.{' '}
          <button type="button" className="underline" onClick={() => refetch()}>Tentar novamente</button>
        </p>
      )}

      {updateMutation.isError && (
        <p role="alert" className="pb-3 text-xs text-destructive">Não foi possível atualizar a denúncia.</p>
      )}

      {!isLoading && !error && reports.length === 0 && (
        <p className="py-4 text-center text-xs text-muted-foreground">Nenhuma denúncia nesta lista.</p>
      )}

      <ul className="divide-y divide-border/40">
        {reports.map((report) => (
          <li key={report.id} className="py-3 text-xs">
            <div className="flex flex-wrap items-center gap-2">
              <span className="px-2 py-0.5 rounded text-[10px] font-bold uppercase bg-destructive/15 text-destructive">
                {REASON_LABELS[report.reason] || report.reason || '-'}
              </span>
              <span className="text-muted-foreground uppercase text-[10px]">{report.content_type}</span>
              <span className="font-medium text-foreground">{report.content_title || report.content_id}</span>
              <span className="ml-auto text-muted-foreground">
                {report.created_at ? new Date(report.created_at.replace(' ', 'T') + 'Z').toLocaleString('pt-BR') : '-'}
              </span>
            </div>
            <p className="mt-1 text-muted-foreground">
              Denunciado: {report.reported_username ? `@${report.reported_username}` : report.reported_user_id || '-'}
              {' · '}
              Por: {report.reporter_username ? `@${report.reporter_username}` : '-'}
            </p>
            {report.details && <p className="mt-1 text-foreground whitespace-pre-wrap break-words">{report.details}</p>}
            {(report.status === 'open' || report.status === 'pending') && (
              <div className="mt-2 flex gap-2">
                <button
                  type="button"
                  disabled={updateMutation.isPending}
                  onClick={() => updateMutation.mutate({ id: report.id, nextStatus: 'resolved' })}
                  className="px-3 py-1 rounded-lg bg-primary text-white text-[11px] font-semibold disabled:opacity-50"
                >
                  Resolver
                </button>
                <button
                  type="button"
                  disabled={updateMutation.isPending}
                  onClick={() => updateMutation.mutate({ id: report.id, nextStatus: 'dismissed' })}
                  className="px-3 py-1 rounded-lg bg-secondary text-foreground text-[11px] font-semibold disabled:opacity-50"
                >
                  Descartar
                </button>
              </div>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}
