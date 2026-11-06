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
import { useFormContext } from 'react-hook-form'
import { useTranslation } from 'react-i18next'

import { StatusBadge } from '@/components/status-badge'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import {
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
} from '@/components/ui/form'
import { Textarea } from '@/components/ui/textarea'

import type { ModerationKeyStatus } from '../../api'
import { splitLines, type ModerationFormValues } from '../../lib/config-form'
import { keyStatusBadge } from '../../lib/display'

/**
 * Saved keys and the replace/clear controls of a chat-model key pool (the
 * judge or the reviewer). Entered keys replace the saved ones on save.
 */
export function ChatKeySection(props: {
  title: string
  emptyText: string
  missingKeyText: string
  enabled: boolean
  savedKeys: ModerationKeyStatus[]
  newKeysName: 'judge_new_api_keys' | 'review_new_api_keys'
  clearName: 'clear_judge_api_keys' | 'clear_review_api_keys'
}) {
  const { t } = useTranslation()
  const form = useFormContext<ModerationFormValues>()
  const clearKeys = form.watch(props.clearName)
  const newKeys = splitLines(form.watch(props.newKeysName))

  return (
    <section className='flex flex-col gap-3 rounded-lg border p-4'>
      <h4 className='text-sm font-medium'>{props.title}</h4>
      {props.savedKeys.length === 0 && (
        <p className='text-muted-foreground text-sm'>{props.emptyText}</p>
      )}
      {props.savedKeys.map((status) => {
        const badge = keyStatusBadge(status.status, t)
        return (
          <div
            key={status.key_hash}
            className='bg-muted/40 flex flex-wrap items-center gap-2 rounded-lg px-3 py-2'
          >
            <span
              className={
                clearKeys
                  ? 'font-mono text-sm line-through'
                  : 'font-mono text-sm'
              }
            >
              {status.masked}
            </span>
            <StatusBadge
              label={badge.label}
              variant={badge.variant}
              copyable={false}
            />
            {status.last_error && (
              <span className='text-destructive text-xs break-words'>
                {status.last_error}
              </span>
            )}
          </div>
        )
      })}
      <FormField
        control={form.control}
        name={props.newKeysName}
        render={({ field }) => (
          <FormItem>
            <FormLabel>{t('New keys, one per line')}</FormLabel>
            <FormControl>
              <Textarea
                rows={3}
                autoComplete='off'
                spellCheck={false}
                className='font-mono text-xs'
                placeholder='sk-...'
                {...field}
              />
            </FormControl>
            <FormDescription>
              {t(
                '{{input}} entered / {{saved}} saved. Entered keys replace the saved keys; leave empty to keep them.',
                { input: newKeys.length, saved: props.savedKeys.length }
              )}
            </FormDescription>
          </FormItem>
        )}
      />
      <div>
        <Button
          type='button'
          size='sm'
          variant={clearKeys ? 'destructive' : 'outline'}
          disabled={props.savedKeys.length === 0}
          onClick={() =>
            form.setValue(props.clearName, !clearKeys, { shouldDirty: true })
          }
        >
          {clearKeys ? t('Keys will be cleared on save') : t('Clear keys')}
        </Button>
      </div>
      {props.enabled &&
        props.savedKeys.length === 0 &&
        newKeys.length === 0 && (
          <Alert variant='destructive'>
            <AlertDescription>{props.missingKeyText}</AlertDescription>
          </Alert>
        )}
    </section>
  )
}
