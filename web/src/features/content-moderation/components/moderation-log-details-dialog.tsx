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
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'

import { ConfirmDialog } from '@/components/confirm-dialog'
import { Dialog } from '@/components/dialog'
import { StatusBadge } from '@/components/status-badge'
import { Button } from '@/components/ui/button'
import {
  DetailRow,
  DetailSection,
} from '@/features/usage-logs/components/dialogs/log-detail-layout'
import dayjs from '@/lib/dayjs'
import { handleServerError } from '@/lib/handle-server-error'

import { unbanModerationUser, type ModerationLog } from '../api'
import { moderationActionBadge, moderationReason } from '../lib/display'

function parseCategoryScores(raw: string): [string, number][] {
  if (!raw) return []
  try {
    const parsed: unknown = JSON.parse(raw)
    if (!parsed || typeof parsed !== 'object') return []
    return Object.entries(parsed)
      .filter(
        (entry): entry is [string, number] => typeof entry[1] === 'number'
      )
      .sort((a, b) => b[1] - a[1])
  } catch {
    return []
  }
}

export function ModerationLogDetailsDialog(props: { entry: ModerationLog }) {
  const { t } = useTranslation()
  const queryClient = useQueryClient()
  const [open, setOpen] = useState(false)
  const [confirmOpen, setConfirmOpen] = useState(false)
  const unban = useMutation({
    mutationFn: () => unbanModerationUser(props.entry.user_id),
    onSuccess: async () => {
      setConfirmOpen(false)
      toast.success(t('User unbanned'))
      await queryClient.invalidateQueries({
        queryKey: ['content-moderation', 'logs'],
      })
    },
    onError: (error) => handleServerError(error, t('Failed to unban user')),
  })
  const badge = moderationActionBadge(props.entry.action, t)
  const scores = parseCategoryScores(props.entry.category_scores).slice(0, 6)

  return (
    <>
      <Dialog
        open={open}
        onOpenChange={setOpen}
        title={t('Violation details')}
        description={t('View the complete details for this log entry')}
        descriptionClassName='sr-only'
        trigger={
          <Button variant='ghost' size='sm' className='h-7 px-2'>
            {t('Details')}
          </Button>
        }
        contentClassName='min-w-0 sm:max-w-lg max-sm:max-h-(--dialog-available-height) max-sm:w-[calc(100vw-1.5rem)] max-sm:max-w-[calc(100vw-1.5rem)]'
        titleClassName='text-base'
        contentHeight='auto'
        bodyClassName='space-y-3'
        footer={
          props.entry.user_id > 0 && props.entry.action !== 'unban' ? (
            <Button variant='outline' onClick={() => setConfirmOpen(true)}>
              {t('Unban user')}
            </Button>
          ) : undefined
        }
      >
        <div className='flex flex-wrap items-center gap-2 text-xs'>
          <StatusBadge
            label={badge.label}
            variant={badge.variant}
            copyable={false}
          />
          {props.entry.auto_banned && (
            <StatusBadge
              label={t('User disabled')}
              variant='danger'
              copyable={false}
            />
          )}
          <span className='text-muted-foreground tabular-nums'>
            {dayjs.unix(props.entry.created_at).format('YYYY-MM-DD HH:mm:ss')}
          </span>
        </div>
        <DetailSection label={t('Violation')}>
          <DetailRow
            label={t('Reason')}
            value={moderationReason(props.entry, t)}
          />
          {props.entry.violation_count > 0 && (
            <DetailRow
              label={t('Violation count')}
              value={props.entry.violation_count}
              mono
            />
          )}
          {scores.map(([category, score]) => (
            <DetailRow
              key={category}
              label={category}
              value={score.toFixed(4)}
              mono
            />
          ))}
        </DetailSection>
        <DetailSection label={t('Request')}>
          <DetailRow
            label={t('User')}
            value={`${props.entry.username || '—'} (#${props.entry.user_id})`}
          />
          {props.entry.token_name && (
            <DetailRow label={t('Token')} value={props.entry.token_name} />
          )}
          {props.entry.group_name && (
            <DetailRow label={t('Group')} value={props.entry.group_name} />
          )}
          {props.entry.model_name && (
            <DetailRow label={t('Model')} value={props.entry.model_name} mono />
          )}
          {props.entry.endpoint && (
            <DetailRow label={t('Route')} value={props.entry.endpoint} mono />
          )}
          {props.entry.request_id && (
            <DetailRow
              label={t('Request ID')}
              value={props.entry.request_id}
              mono
            />
          )}
        </DetailSection>
        {props.entry.input_excerpt && (
          <DetailSection label={t('Input excerpt')}>
            <p className='bg-muted max-h-60 overflow-y-auto rounded-md p-2 text-sm break-words whitespace-pre-wrap'>
              {props.entry.input_excerpt}
            </p>
          </DetailSection>
        )}
      </Dialog>
      <ConfirmDialog
        open={confirmOpen}
        onOpenChange={setConfirmOpen}
        title={t('Unban user')}
        desc={t('Enable user {{name}} again and reset the violation count?', {
          name: props.entry.username || `#${props.entry.user_id}`,
        })}
        confirmText={t('Unban')}
        isLoading={unban.isPending}
        handleConfirm={() => unban.mutate()}
      />
    </>
  )
}
