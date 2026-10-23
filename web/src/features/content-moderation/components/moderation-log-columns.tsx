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
import { moderationActionBadge, moderationReason } from '../lib/display'
import { ModerationLogDetailsDialog } from './moderation-log-details-dialog'

export function useModerationLogColumns(): ColumnDef<ModerationLog>[] {
  const { t } = useTranslation()
  return useMemo(
    () => [
      {
        accessorKey: 'created_at',
        header: t('Time'),
        size: 170,
        cell: ({ row }) => (
          <span className='font-mono tabular-nums'>
            {dayjs.unix(row.original.created_at).format('YYYY-MM-DD HH:mm:ss')}
          </span>
        ),
        meta: { label: t('Time'), mobileTitle: true },
      },
      {
        accessorKey: 'username',
        header: t('User'),
        size: 130,
        cell: ({ row }) => (
          <TruncatedCell className='max-w-32'>
            {`${row.original.username || '—'} #${row.original.user_id}`}
          </TruncatedCell>
        ),
        meta: { label: t('User') },
      },
      {
        accessorKey: 'action',
        header: t('Action'),
        size: 110,
        cell: ({ row }) => {
          const badge = moderationActionBadge(row.original.action, t)
          return (
            <div className='flex flex-wrap gap-1'>
              <StatusBadge
                label={badge.label}
                variant={badge.variant}
                copyable={false}
              />
              {row.original.auto_banned && (
                <StatusBadge
                  label={t('User disabled')}
                  variant='danger'
                  copyable={false}
                />
              )}
            </div>
          )
        },
        meta: { label: t('Action'), mobileBadge: true },
      },
      {
        id: 'reason',
        header: t('Reason'),
        size: 200,
        accessorFn: (entry) => moderationReason(entry, t),
        cell: ({ getValue }) => (
          <TruncatedCell className='max-w-52'>
            {getValue<string>()}
          </TruncatedCell>
        ),
        meta: { label: t('Reason') },
      },
      {
        accessorKey: 'model_name',
        header: t('Model'),
        size: 160,
        cell: ({ row }) => (
          <TruncatedCell className='max-w-40 font-mono'>
            {row.original.model_name || '—'}
          </TruncatedCell>
        ),
        meta: { label: t('Model'), mobileHidden: true },
      },
      {
        accessorKey: 'input_excerpt',
        header: t('Input excerpt'),
        size: 280,
        cell: ({ row }) => (
          <TruncatedCell className='max-w-72'>
            {row.original.input_excerpt || '—'}
          </TruncatedCell>
        ),
        meta: { label: t('Input excerpt'), mobileHidden: true },
      },
      {
        id: 'details',
        header: t('Details'),
        size: 70,
        enableHiding: false,
        cell: ({ row }) => <ModerationLogDetailsDialog entry={row.original} />,
        meta: { label: t('Details') },
      },
    ],
    [t]
  )
}
