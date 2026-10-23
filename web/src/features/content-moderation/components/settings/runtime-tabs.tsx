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
import { useFormContext } from 'react-hook-form'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'

import { ConfirmDialog } from '@/components/confirm-dialog'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  SettingsControlGroup,
  SettingsFormGrid,
} from '@/features/system-settings/components/settings-form-layout'
import dayjs from '@/lib/dayjs'
import { handleServerError } from '@/lib/handle-server-error'

import {
  clearModerationHashes,
  deleteModerationHash,
  type ModerationStatus,
} from '../../api'
import type { ModerationFormValues } from '../../lib/config-form'
import { NumberField, SwitchField } from './fields'

export function QueueTab(props: { status?: ModerationStatus }) {
  const { t } = useTranslation()
  const form = useFormContext<ModerationFormValues>()
  const queryClient = useQueryClient()
  const [hash, setHash] = useState('')
  const [confirmClear, setConfirmClear] = useState(false)
  const refreshStatus = () =>
    queryClient.invalidateQueries({
      queryKey: ['content-moderation', 'status'],
    })
  const removeHash = useMutation({
    mutationFn: () => deleteModerationHash(hash.trim()),
    onSuccess: (result) => {
      toast.success(result.deleted ? t('Hash deleted') : t('Hash not found'))
      setHash('')
      void refreshStatus()
    },
    onError: (error) => handleServerError(error),
  })
  const clearAll = useMutation({
    mutationFn: clearModerationHashes,
    onSuccess: (result) => {
      setConfirmClear(false)
      toast.success(t('Cleared {{count}} hashes', { count: result.deleted }))
      void refreshStatus()
    },
    onError: (error) => handleServerError(error),
  })

  return (
    <div className='flex flex-col gap-5'>
      <SettingsFormGrid>
        <NumberField
          control={form.control}
          name='worker_count'
          label={t('Worker count')}
          description={t(
            'Async workers for observe mode and record writes (1-32).'
          )}
        />
        <NumberField
          control={form.control}
          name='queue_size'
          label={t('Queue size')}
          description={t(
            'Jobs beyond the queue size are dropped (100-100000).'
          )}
        />
      </SettingsFormGrid>
      <SettingsControlGroup>
        <SwitchField
          control={form.control}
          name='record_non_hits'
          label={t('Record non-hits')}
          description={t(
            'Also records passed and failed checks; kept for at most 3 days.'
          )}
        />
        <SwitchField
          control={form.control}
          name='pre_hash_check_enabled'
          label={t('Flagged content hash pre-check')}
          description={t(
            'Content that was flagged before is blocked without calling the moderation API. Requires Redis; hash blocks do not count toward bans.'
          )}
        />
      </SettingsControlGroup>
      <section className='flex flex-col gap-3 rounded-lg border p-4'>
        <div className='flex items-center justify-between'>
          <span className='text-sm font-medium'>
            {t('Flagged content hashes: {{count}}', {
              count: props.status?.flagged_hash_count ?? 0,
            })}
          </span>
          <Button
            type='button'
            size='sm'
            variant='outline'
            onClick={() => setConfirmClear(true)}
          >
            {t('Clear all')}
          </Button>
        </div>
        {props.status && !props.status.redis_enabled && (
          <Alert>
            <AlertDescription>
              {t('Redis is not enabled, so flagged hashes are not stored.')}
            </AlertDescription>
          </Alert>
        )}
        <div className='flex gap-2'>
          <Input
            value={hash}
            onChange={(event) => setHash(event.target.value)}
            placeholder={t('64-character content hash')}
            aria-label={t('Content hash')}
            className='font-mono text-xs'
          />
          <Button
            type='button'
            size='sm'
            variant='outline'
            disabled={
              !/^[0-9a-fA-F]{64}$/.test(hash.trim()) || removeHash.isPending
            }
            onClick={() => removeHash.mutate()}
          >
            {t('Delete')}
          </Button>
        </div>
      </section>
      <ConfirmDialog
        open={confirmClear}
        onOpenChange={setConfirmClear}
        title={t('Clear all flagged hashes')}
        desc={t(
          'Previously flagged content will be checked by the moderation API again.'
        )}
        confirmText={t('Clear all')}
        destructive
        isLoading={clearAll.isPending}
        handleConfirm={() => clearAll.mutate()}
      />
    </div>
  )
}

export function RetentionTab(props: { status?: ModerationStatus }) {
  const { t } = useTranslation()
  const form = useFormContext<ModerationFormValues>()
  const status = props.status
  return (
    <div className='flex flex-col gap-5'>
      <SettingsFormGrid>
        <NumberField
          control={form.control}
          name='hit_retention_days'
          label={t('Hit retention (days)')}
          description={t('Records of hits are kept for 1-3650 days.')}
        />
        <NumberField
          control={form.control}
          name='non_hit_retention_days'
          label={t('Non-hit retention (days)')}
          description={t('Records of non-hits are kept for 1-3 days.')}
        />
      </SettingsFormGrid>
      <p className='text-muted-foreground text-sm'>
        {status && status.last_cleanup_at > 0
          ? t(
              'Last cleanup at {{time}} removed {{hit}} hit and {{nonHit}} non-hit records.',
              {
                time: dayjs
                  .unix(status.last_cleanup_at)
                  .format('YYYY-MM-DD HH:mm:ss'),
                hit: status.last_cleanup_deleted_hit,
                nonHit: status.last_cleanup_deleted_non_hit,
              }
            )
          : t('Cleanup runs 5 minutes after startup and then daily.')}
      </p>
    </div>
  )
}
