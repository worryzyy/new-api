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

import { Alert, AlertDescription } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import {
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from '@/components/ui/form'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import {
  SettingsControlGroup,
  SettingsFormGrid,
} from '@/features/system-settings/components/settings-form-layout'

import type { ModerationStatus } from '../../api'
import {
  MAX_BLOCKED_KEYWORDS,
  MODERATION_CATEGORIES,
  defaultThresholdPercents,
  splitLines,
  type ModerationFormValues,
} from '../../lib/config-form'
import { NumberField, RadioCards, SwitchField } from './fields'

export function HitTab(props: { status?: ModerationStatus }) {
  const { t } = useTranslation()
  const form = useFormContext<ModerationFormValues>()
  const autoBan = form.watch('auto_ban_enabled')
  const sessionBlock = form.watch('cyber_session_block_enabled')
  return (
    <div className='flex flex-col gap-5'>
      <SettingsFormGrid>
        <NumberField
          control={form.control}
          name='block_status'
          label={t('Block status code')}
          description={t(
            'HTTP status returned for blocked requests (400-599).'
          )}
        />
        <FormField
          control={form.control}
          name='block_message'
          render={({ field }) => (
            <FormItem>
              <FormLabel>{t('Block message')}</FormLabel>
              <FormControl>
                <Input
                  placeholder={t(
                    'Leave empty to use the default localized message'
                  )}
                  {...field}
                />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />
      </SettingsFormGrid>
      <SettingsControlGroup>
        <SwitchField
          control={form.control}
          name='auto_ban_enabled'
          label={t('Automatic ban')}
          description={t(
            'Disables a user who reaches the violation threshold within the window. Administrators are never disabled, and the count restarts after each ban.'
          )}
        />
      </SettingsControlGroup>
      {autoBan && (
        <SettingsFormGrid>
          <NumberField
            control={form.control}
            name='ban_threshold'
            label={t('Ban threshold')}
            description={t(
              'Distinct violating messages that disable the user (1-1000). Requests, retries and agent steps of the same message count once.'
            )}
          />
          <NumberField
            control={form.control}
            name='violation_window_hours'
            label={t('Counting window (hours)')}
            description={t(
              'Only violations within this window are counted (1-8760).'
            )}
          />
        </SettingsFormGrid>
      )}
      <section className='flex flex-col gap-4 rounded-lg border p-4'>
        <div className='flex flex-col gap-1'>
          <span className='text-sm font-medium'>
            {t('Upstream cyber_policy')}
          </span>
          <p className='text-muted-foreground text-sm'>
            {t(
              'When OpenAI rejects a request with error code cyber_policy, the rejection is recorded as an audit hit. It follows the audit switch and scope, but not the moderation mode or sampling.'
            )}
          </p>
          <p className='text-muted-foreground text-xs tabular-nums'>
            {t(
              'Since this process started: {{hits}} cyber_policy hits, {{blocked}} session blocks',
              {
                hits: props.status?.cyber_policy_hits ?? 0,
                blocked: props.status?.cyber_session_blocked ?? 0,
              }
            )}
          </p>
        </div>
        <SettingsControlGroup>
          <SwitchField
            control={form.control}
            name='cyber_policy_exclude_from_ban_count'
            label={t('Do not count cyber_policy toward bans')}
            description={t(
              'cyber_policy hits are still recorded but no longer count toward automatic bans, including earlier hits.'
            )}
          />
          <SwitchField
            control={form.control}
            name='cyber_session_block_enabled'
            label={t('Block cyber_policy sessions')}
            description={t(
              'Rejects further requests of a conversation that upstream rejected with cyber_policy, without sending them upstream. Only that conversation is blocked; other conversations of the same key are not affected. Exempt users are never blocked.'
            )}
          />
        </SettingsControlGroup>
        {sessionBlock && (
          <SettingsFormGrid>
            <NumberField
              control={form.control}
              name='cyber_session_block_ttl_seconds'
              label={t('Session block duration (seconds)')}
              description={t('1-2592000 seconds.')}
            />
          </SettingsFormGrid>
        )}
        {sessionBlock && props.status && !props.status.redis_enabled && (
          <Alert>
            <AlertDescription>
              {t(
                'Redis is not enabled, so cyber_policy sessions are not blocked.'
              )}
            </AlertDescription>
          </Alert>
        )}
      </section>
    </div>
  )
}

export function ThresholdsTab() {
  const { t } = useTranslation()
  const form = useFormContext<ModerationFormValues>()
  return (
    <div className='flex flex-col gap-4'>
      <div className='flex items-center justify-between gap-2'>
        <p className='text-muted-foreground text-sm'>
          {t(
            'A request is a hit when any category score reaches its threshold. Values are percentages.'
          )}
        </p>
        <Button
          type='button'
          size='sm'
          variant='outline'
          onClick={() =>
            form.setValue('thresholds', defaultThresholdPercents(), {
              shouldDirty: true,
            })
          }
        >
          {t('Reset to defaults')}
        </Button>
      </div>
      <div className='grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3'>
        {MODERATION_CATEGORIES.map((category) => (
          <FormField
            key={category.name}
            control={form.control}
            name={`thresholds.${category.name}`}
            render={({ field }) => (
              <FormItem className='rounded-lg border p-3'>
                <FormLabel className='font-mono text-xs'>
                  {category.name}
                </FormLabel>
                <FormControl>
                  <Input
                    type='number'
                    step={0.1}
                    value={Number.isFinite(field.value) ? field.value : ''}
                    onChange={(event) =>
                      field.onChange(event.target.valueAsNumber)
                    }
                    onBlur={field.onBlur}
                  />
                </FormControl>
                <FormDescription>
                  {t('Default {{value}}%', {
                    value: Math.round(category.threshold * 1000) / 10,
                  })}
                </FormDescription>
                <FormMessage />
              </FormItem>
            )}
          />
        ))}
      </div>
    </div>
  )
}

export function KeywordsTab() {
  const { t } = useTranslation()
  const form = useFormContext<ModerationFormValues>()
  const mode = form.watch('keyword_blocking_mode')
  const count = splitLines(form.watch('blocked_keywords')).length
  let hint = t(
    'Keywords are matched first; requests without a keyword hit are sent to the moderation API.'
  )
  if (mode === 'keyword_only') {
    hint = t('Only keywords are checked; the moderation API is never called.')
  } else if (mode === 'api_only') {
    hint = t(
      'Keywords are ignored; every sampled request is sent to the moderation API.'
    )
  }
  return (
    <div className='flex flex-col gap-5'>
      <Alert>
        <AlertDescription>{hint}</AlertDescription>
      </Alert>
      <RadioCards
        legend={t('Keyword blocking mode')}
        value={mode}
        options={[
          {
            value: 'keyword_and_api',
            label: t('Keywords + API'),
            description: t(
              'Keyword hits block directly, others go to the API.'
            ),
          },
          {
            value: 'keyword_only',
            label: t('Keywords only'),
            description: t('No moderation API calls.'),
          },
          {
            value: 'api_only',
            label: t('API only'),
            description: t('Keywords are not used.'),
          },
        ]}
        onChange={(value) =>
          form.setValue('keyword_blocking_mode', value, { shouldDirty: true })
        }
      />
      <FormField
        control={form.control}
        name='blocked_keywords'
        render={({ field }) => (
          <FormItem>
            <FormLabel>{t('Blocked keywords')}</FormLabel>
            <FormControl>
              <Textarea
                rows={10}
                disabled={mode === 'api_only'}
                placeholder={t('Enter one keyword per line')}
                {...field}
              />
            </FormControl>
            <FormDescription>
              {t(
                '{{count}} / {{max}} keywords, matched case-insensitively. Keyword hits count toward automatic bans.',
                {
                  count,
                  max: MAX_BLOCKED_KEYWORDS,
                }
              )}
            </FormDescription>
            <FormMessage />
          </FormItem>
        )}
      />
    </div>
  )
}
