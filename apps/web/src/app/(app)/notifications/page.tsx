'use client';

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Bell, CheckCheck, Inbox } from 'lucide-react';
import { api } from '@/lib/api';

interface Notification {
  id: string;
  type: string;
  title: string;
  body: string;
  readAt: string | null;
  createdAt: string;
}
interface NotificationsResponse {
  items: Notification[];
  total: number;
  unreadCount: number;
}

export default function NotificationsPage() {
  const qc = useQueryClient();

  const { data, isLoading } = useQuery({
    queryKey: ['notifications'],
    queryFn: () => api.get<NotificationsResponse>('/v1/notifications?pageSize=50'),
  });

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ['notifications'] });
    qc.invalidateQueries({ queryKey: ['notif-count'] });
  };

  const markRead = useMutation({
    mutationFn: (id: string) => api.post(`/v1/notifications/${id}/read`),
    onSuccess: invalidate,
  });
  const markAllRead = useMutation({
    mutationFn: () => api.post('/v1/notifications/read-all'),
    onSuccess: invalidate,
  });

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-lg font-semibold">Notifications</h1>
        {(data?.unreadCount ?? 0) > 0 && (
          <button onClick={() => markAllRead.mutate()} className="btn-secondary">
            <CheckCheck className="h-4 w-4" /> Mark all read
          </button>
        )}
      </div>

      {isLoading ? (
        <div className="card text-sm text-muted-foreground">Loading…</div>
      ) : !data?.items?.length ? (
        <div className="card text-center text-sm text-muted-foreground">
          <Inbox className="mx-auto mb-3 h-8 w-8 text-muted-foreground" />
          You have no notifications yet.
        </div>
      ) : (
        <ul className="space-y-2">
          {data.items.map((n) => (
            <li
              key={n.id}
              className={`card flex items-start gap-3 ${n.readAt ? '' : 'border-l-4 border-l-brand-500'}`}
            >
              <Bell
                className={`mt-0.5 h-4 w-4 shrink-0 ${n.readAt ? 'text-muted-foreground' : 'text-brand-500'}`}
              />
              <div className="min-w-0 flex-1">
                <p className="font-medium text-foreground">{n.title}</p>
                <p className="text-sm text-muted-foreground">{n.body}</p>
                <p className="mt-1 text-xs text-muted-foreground">
                  {new Date(n.createdAt).toLocaleString()}
                </p>
              </div>
              {!n.readAt && (
                <button
                  onClick={() => markRead.mutate(n.id)}
                  className="shrink-0 text-xs text-brand-600 hover:underline"
                >
                  Mark read
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
