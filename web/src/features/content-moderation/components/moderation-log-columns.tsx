/*
Copyright (C) 2023-2026 QuantumNous

This program is free software: you can redistribute it and/or modify
it under the terms of the GNU Affero General Public License as
published by the Free Software Foundation, either version 3 of the
License, or (at your option) any later version.

This program is distributed in the hope that it will be useful,
but WITHOUT ANY WARRANTY; without even the implied warranty of
MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE. See the
GNU Affero General Public License for more details.

You should have received a copy of the GNU Affero General Public License
along with this program. If not, see <https://www.gnu.org/licenses/>.

For commercial licensing, please contact support@quantumnous.com
*/
import type { ColumnDef } from '@tanstack/react-table'
import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'

import { TruncatedCell } from '@/components/data-table'
import { StatusBadge } from '@/components/status-badge'
import dayjs from '@/lib/dayjs'

import type { ModerationLog } from '../api'
import { formatPercent, moderationResultBadge } from '../lib/display'
import { ModerationLogDetailsDialog } from './moderation-log-details-dialog'
import { UnbanUserButton } from './unban-user-button'

const USER_STATUS_DISABLED = 2

export function useModerationLogColumns(): ColumnDef<ModerationLog>[] {
  const { t } = useTranslation()
  return useMemo(
    () => [
      {
        accessorKey: 'created_at',
        header: t('Time'),
        size: 160,
        cell: ({ row }) => (
          <span className='font-mono tabular-nums'>
            {dayjs.unix(row.original.created_at).format('YYYY-MM-DD HH:mm:ss')}
          </span>
        ),
        meta: { label: t('Time'), mobileTitle: true },
      },
      {
        accessorKey: 'group_name',
        header: t('Group'),
        size: 90,
        cell: ({ row }) => row.original.group_name || '—',
        meta: { label: t('Group'), mobileHidden: true },
      },
      {
        accessorKey: 'username',
        header: t('User'),
        size: 160,
        cell: ({ row }) => (
          <div className='min-w-0'>
            <TruncatedCell className='max-w-40'>
              {row.original.user_email || row.original.username || '—'}
            </TruncatedCell>
            <div className='text-muted-foreground text-xs'>
              UID {row.original.user_id}
            </div>
          </div>
        ),
        meta: { label: t('User') },
      },
      {
        accessorKey: 'token_name',
        header: t('API Key'),
        size: 110,
        cell: ({ row }) => (
          <TruncatedCell className='max-w-28'>
            {row.original.token_name || '—'}
          </TruncatedCell>
        ),
        meta: { label: t('API Key'), mobileHidden: true },
      },
      {
        accessorKey: 'endpoint',
        header: t('Endpoint'),
        size: 170,
        cell: ({ row }) => (
          <div className='min-w-0'>
            <TruncatedCell className='max-w-44 font-mono'>
              {row.original.endpoint || '—'}
            </TruncatedCell>
            <TruncatedCell className='text-muted-foreground max-w-44 text-xs'>
              {row.original.model_name || '—'}
            </TruncatedCell>
          </div>
        ),
        meta: { label: t('Endpoint'), mobileHidden: true },
      },
      {
        id: 'result',
        header: t('Result'),
        size: 100,
        cell: ({ row }) => {
          const badge = moderationResultBadge(row.original, t)
          return (
            <StatusBadge
              label={badge.label}
              variant={badge.variant}
              copyable={false}
            />
          )
        },
        meta: { label: t('Result'), mobileBadge: true },
      },
      {
        id: 'risk',
        header: t('Highest risk'),
        size: 150,
        cell: ({ row }) => {
          if (row.original.matched_keyword) {
            return (
              <TruncatedCell className='text-destructive max-w-36'>
                {t('Keyword: {{keyword}}', {
                  keyword: row.original.matched_keyword,
                })}
              </TruncatedCell>
            )
          }
          if (!row.original.category) return '—'
          return (
            <div className='text-xs'>
              <div className='truncate'>{row.original.category}</div>
              <div className='text-muted-foreground tabular-nums'>
                {formatPercent(row.original.score)}
              </div>
            </div>
          )
        },
        meta: { label: t('Highest risk') },
      },
      {
        id: 'disposition',
        header: t('Disposition'),
        size: 130,
        cell: ({ row }) => (
          <div className='flex flex-col items-start gap-1 text-xs'>
            {row.original.violation_count > 0 && (
              <span className='tabular-nums'>
                {t('Violation {{count}}', {
                  count: row.original.violation_count,
                })}
              </span>
            )}
            {row.original.auto_banned && (
              <StatusBadge
                label={t('User disabled')}
                variant='danger'
                copyable={false}
              />
            )}
            {row.original.auto_banned &&
              row.original.user_status === USER_STATUS_DISABLED && (
                <UnbanUserButton entry={row.original} />
              )}
            {!row.original.violation_count && !row.original.auto_banned && '—'}
          </div>
        ),
        meta: { label: t('Disposition') },
      },
      {
        id: 'latency',
        header: t('Latency'),
        size: 100,
        cell: ({ row }) => (
          <div className='text-xs tabular-nums'>
            <div>{row.original.upstream_latency_ms} ms</div>
            {row.original.queue_delay_ms > 0 && (
              <div className='text-muted-foreground'>
                {t('Queue {{ms}} ms', { ms: row.original.queue_delay_ms })}
              </div>
            )}
          </div>
        ),
        meta: { label: t('Latency'), mobileHidden: true },
      },
      {
        accessorKey: 'input_excerpt',
        header: t('Input'),
        size: 240,
        enableHiding: false,
        cell: ({ row }) => <ModerationLogDetailsDialog entry={row.original} />,
        meta: { label: t('Input') },
      },
    ],
    [t]
  )
}
