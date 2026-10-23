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
import { useMutation } from '@tanstack/react-query'
import { Trash2, Undo2 } from 'lucide-react'
import { useState } from 'react'
import { useFormContext } from 'react-hook-form'
import { useTranslation } from 'react-i18next'

import { StatusBadge } from '@/components/status-badge'
import { Button } from '@/components/ui/button'
import {
  FormControl,
  FormField,
  FormItem,
  FormLabel,
} from '@/components/ui/form'
import { Textarea } from '@/components/ui/textarea'
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group'
import { handleServerError } from '@/lib/handle-server-error'

import {
  testModerationKeys,
  type ModerationConfigView,
  type ModerationKeyStatus,
} from '../../api'
import { splitLines, type ModerationFormValues } from '../../lib/config-form'
import { keyStatusBadge } from '../../lib/display'
import { ModerationTestPanel } from './moderation-test-panel'

export function KeyPoolSection(props: { config: ModerationConfigView }) {
  const { t } = useTranslation()
  const form = useFormContext<ModerationFormValues>()
  const [tested, setTested] = useState<ModerationKeyStatus[] | null>(null)
  const newKeys = splitLines(form.watch('new_api_keys'))
  const pendingDeletes = form.watch('delete_api_key_hashes')
  const clearKeys = form.watch('clear_api_keys')
  const keysMode = form.watch('api_keys_mode')

  const test = useMutation({
    mutationFn: (keys?: string[]) =>
      testModerationKeys({
        api_keys: keys,
        base_url: form.getValues('base_url'),
        model: form.getValues('model'),
        timeout_ms: form.getValues('timeout_ms'),
      }),
    onSuccess: (result) => setTested(result.items),
    onError: (error) => handleServerError(error, t('Moderation test failed')),
  })

  const statuses = tested ?? props.config.api_key_statuses
  const toggleDelete = (hash: string) => {
    const next = pendingDeletes.includes(hash)
      ? pendingDeletes.filter((item) => item !== hash)
      : [...pendingDeletes, hash]
    form.setValue('delete_api_key_hashes', next, { shouldDirty: true })
  }

  return (
    <section className='flex flex-col gap-4 rounded-lg border p-4'>
      <div className='flex flex-wrap items-center justify-between gap-2'>
        <h4 className='text-sm font-medium'>{t('API keys')}</h4>
        <ToggleGroup
          value={[keysMode]}
          onValueChange={(values) => {
            const value = values[0]
            if (value === 'append' || value === 'replace') {
              form.setValue('api_keys_mode', value, { shouldDirty: true })
            }
          }}
        >
          <ToggleGroupItem value='append'>{t('Append')}</ToggleGroupItem>
          <ToggleGroupItem value='replace'>{t('Replace')}</ToggleGroupItem>
        </ToggleGroup>
      </div>
      <div className='grid grid-cols-1 gap-4 lg:grid-cols-2'>
        <div className='flex flex-col gap-3'>
          <FormField
            control={form.control}
            name='new_api_keys'
            render={({ field }) => (
              <FormItem>
                <FormLabel>{t('New keys, one per line')}</FormLabel>
                <FormControl>
                  <Textarea
                    rows={5}
                    autoComplete='off'
                    spellCheck={false}
                    className='font-mono text-xs'
                    placeholder='sk-...'
                    {...field}
                  />
                </FormControl>
              </FormItem>
            )}
          />
          <p className='text-muted-foreground text-xs'>
            {t(
              '{{input}} entered / {{saved}} saved. Leave empty to keep the saved keys.',
              {
                input: newKeys.length,
                saved: props.config.api_key_count,
              }
            )}
          </p>
          <div className='flex flex-wrap gap-2'>
            <Button
              type='button'
              size='sm'
              variant='outline'
              disabled={newKeys.length === 0 || test.isPending}
              onClick={() => test.mutate(newKeys)}
            >
              {t('Test entered keys')}
            </Button>
            <Button
              type='button'
              size='sm'
              variant='outline'
              disabled={props.config.api_key_count === 0 || test.isPending}
              onClick={() => test.mutate(undefined)}
            >
              {t('Test saved keys')}
            </Button>
            <Button
              type='button'
              size='sm'
              variant={clearKeys ? 'destructive' : 'outline'}
              disabled={props.config.api_key_count === 0}
              onClick={() =>
                form.setValue('clear_api_keys', !clearKeys, {
                  shouldDirty: true,
                })
              }
            >
              {clearKeys ? t('Keys will be cleared on save') : t('Clear keys')}
            </Button>
          </div>
        </div>
        <div className='flex flex-col gap-2'>
          <div className='flex items-center justify-between'>
            <span className='text-sm font-medium'>{t('Key health')}</span>
          </div>
          <p className='text-muted-foreground text-xs'>
            {t(
              '400 does not freeze; 401/403 freeze for 10 minutes; 429/529 for 1 minute; other errors for 10 seconds.'
            )}
          </p>
          {statuses.length === 0 && (
            <p className='text-muted-foreground py-4 text-center text-sm'>
              {t('No moderation API key configured')}
            </p>
          )}
          {statuses.map((status) => {
            const badge = keyStatusBadge(status.status, t)
            const deleting = pendingDeletes.includes(status.key_hash)
            return (
              <div
                key={`${status.key_hash}-${status.configured}`}
                className='bg-muted/40 rounded-lg px-3 py-2'
              >
                <div className='flex items-center justify-between gap-2'>
                  <div className='flex min-w-0 items-center gap-2'>
                    <span
                      className={
                        deleting
                          ? 'truncate font-mono text-sm line-through'
                          : 'truncate font-mono text-sm'
                      }
                    >
                      {status.masked}
                    </span>
                    <StatusBadge
                      label={status.configured ? t('Saved') : t('Temporary')}
                      variant='neutral'
                      copyable={false}
                    />
                    <StatusBadge
                      label={badge.label}
                      variant={badge.variant}
                      copyable={false}
                    />
                  </div>
                  {status.configured && keysMode === 'append' && (
                    <Button
                      type='button'
                      size='icon'
                      variant='ghost'
                      className='size-7'
                      aria-label={deleting ? t('Keep key') : t('Delete key')}
                      onClick={() => toggleDelete(status.key_hash)}
                    >
                      {deleting ? (
                        <Undo2 aria-hidden='true' />
                      ) : (
                        <Trash2 aria-hidden='true' />
                      )}
                    </Button>
                  )}
                </div>
                {status.last_error && (
                  <p className='text-destructive mt-1 text-xs break-words'>
                    {status.last_error}
                  </p>
                )}
              </div>
            )
          })}
        </div>
      </div>
      <ModerationTestPanel />
    </section>
  )
}
